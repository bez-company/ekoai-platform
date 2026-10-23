'use client';

// AskAdjust.tsx: "Pedir ajuste" em texto livre (SPEC 024, BEZ-193; protótipo v9 aprovado). A pessoa escreve o que
// mudar e, se quiser, onde. O servidor lê o pedido com uma chamada de texto, aplica só o que foi pedido pela mesma
// via do Confirmar (revisor, conflito de versão) e grava uma versão nova; a tela mostra o antes e depois e deixa
// desfazer (restaurar a versão anterior). Visual novo não é feito aqui: avisa que conta no limite e leva a
// "Outra direção". Não chama o modelo de imagem.

import { useState } from 'react';
import { Spinner } from '@/components/auth/ui';
import { ASPECTS, ASPECT_LABEL, changeRows, MAX_INSTRUCTION, type Aspect, type AskResponse } from '@/lib/design-ask-view';

type Phase = 'idle' | 'applying' | 'result' | 'visual' | 'undone';

const PLACEHOLDER = 'Ex.: tira o subtítulo e deixa só os 3 itens';
const FAILED = 'Não foi possível aplicar o ajuste agora. Nada foi alterado. Tente de novo.';

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export default function AskAdjust({
  briefId,
  version,
  body,
  hashtags,
  usage,
  blockedReason,
  busyElsewhere,
  onCaption,
  onChanged,
  onDirection,
}: {
  briefId: string;
  version: number;
  body: string;
  hashtags: string[];
  usage: { used: number; max: number };
  blockedReason: string | null; // por que o campo está parado (mudança da imagem sem confirmar)
  busyElsewhere: boolean;
  onCaption: (body: string, hashtags: string[]) => void;
  onChanged: (version: number) => void; // o design mudou no servidor: a tela recarrega as versões e a imagem
  onDirection: () => void;
}) {
  const [text, setText] = useState('');
  const [aspect, setAspect] = useState<Aspect | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [before, setBefore] = useState<{ body: string; hashtags: string[] } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const busy = phase === 'applying' || undoing;
  const stopped = !!blockedReason || busyElsewhere;

  async function apply() {
    const instruction = text.trim();
    if (!instruction) return setError('Escreva o que você quer mudar no post.');
    setPhase('applying');
    setError('');
    const r = await post(`/api/posts/${briefId}/design/ask`, { baseVersion: version, instruction, aspect, caption: body, hashtags }).catch(() => null);
    if (!r) {
      setPhase('idle');
      return setError(FAILED);
    }
    if (!r.ok) {
      setPhase('idle');
      // 409: outra pessoa salvou antes. A tela recarrega as versões para o próximo pedido partir da atual.
      if (r.status === 409) onChanged(Number((r.body.current as { version?: number } | null)?.version ?? version));
      return setError(r.status >= 500 || !r.body.error ? FAILED : String(r.body.error));
    }
    const out = r.body as unknown as AskResponse;
    setResult(out);
    if (out.needsVisual && out.version === null && !out.caption) return setPhase('visual');
    setBefore({ body, hashtags });
    if (out.caption) onCaption(out.caption.caption, out.caption.hashtags);
    if (out.version !== null) onChanged(out.version);
    setPhase('result');
  }

  async function undo() {
    if (!result) return;
    setUndoing(true);
    setError('');
    if (result.version !== null) {
      const r = await post(`/api/posts/${briefId}/design/revisions/${result.previousVersion}/restore`, { baseVersion: result.version }).catch(() => null);
      if (!r || !r.ok) {
        setUndoing(false);
        if (r?.status === 409) onChanged(Number((r.body.current as { version?: number } | null)?.version ?? result.version));
        return setError(r && r.status < 500 && r.body.error ? String(r.body.error) : 'Não foi possível desfazer agora. A versão anterior continua na lista de versões.');
      }
      onChanged(Number(r.body.version));
    }
    if (result.caption && before) onCaption(before.body, before.hashtags);
    setUndoing(false);
    setPhase('undone');
  }

  function again() {
    setPhase('idle');
    setResult(null);
    setBefore(null);
    setText('');
    setAspect(null);
  }

  const rows = result ? changeRows(result.diff, !!result.caption) : [];
  const stoppedHelp = blockedReason ?? (busyElsewhere ? 'Espere o outro ajuste terminar.' : null);

  return (
    <div className="space-y-3" aria-busy={busy}>
      <p className="text-sm text-muted">Diga o que mudar. Só isso muda, o resto do post fica igual.</p>

      {phase === 'applying' && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <Spinner />
          <span>
            <strong>Lendo o pedido e ajustando o post.</strong> Só o que você pediu muda. Não gasta do limite do mês.
          </span>
        </div>
      )}

      {phase === 'result' && result && (
        <>
          <div className="space-y-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
            <p>
              <strong>Ajuste aplicado.</strong>{' '}
              {result.version !== null ? `${result.summary ?? 'Versão nova salva'}. O revisor conferiu de novo: contraste, tamanho do texto e palavras proibidas.` : 'A legenda foi ajustada e vale quando você aprovar o post.'}
            </p>
            <button type="button" className="btn-ghost min-h-9" disabled={busy} onClick={undo}>
              {undoing ? <Spinner /> : null}
              {undoing ? 'Desfazendo…' : 'Desfazer ajuste'}
            </button>
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm" aria-label="O que mudou">
            {rows.map((row) => (
              <li key={`${row.label}-${row.before}-${row.after}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="chip border-success/30 text-success">Mudou</span>
                <strong>{row.label}</strong>
                <span className="text-muted">
                  {row.before} → {row.after}
                </span>
              </li>
            ))}
            <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
              <span className="chip">Igual</span>
              <strong>Todo o resto</strong>
              <span className="text-muted">Título, itens, legenda, hashtags, visual, cores e logo, no que você não pediu.</span>
            </li>
          </ul>
        </>
      )}

      {phase === 'undone' && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <strong>Ajuste desfeito.</strong> O post voltou ao que era antes do pedido. A versão do ajuste continua na lista de versões.
        </div>
      )}

      {result && result.notApplied.length > 0 && (phase === 'result' || phase === 'visual') && (
        <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
          <strong>Parte do pedido não foi aplicada.</strong>
          <ul className="list-disc pl-5">
            {result.notApplied.map((n) => (
              <li key={`${n.what}-${n.why}`}>
                <strong>{n.what}:</strong> {n.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === 'visual' && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
          <p>
            <strong>Visual novo gera o post de novo</strong> (outro ângulo e outro visual) e conta 1 no limite: {usage.used} de {usage.max} posts este mês. Este post sai da fila.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busyElsewhere} onClick={onDirection}>
              Gerar outra direção
            </button>
            <button type="button" className="btn-ghost" onClick={again}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(phase === 'idle' || phase === 'applying') && (
        <>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">O que você quer mudar?</span>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
              rows={3}
              maxLength={MAX_INSTRUCTION}
              placeholder={PLACEHOLDER}
              className="input resize-y"
              disabled={busy || stopped}
              aria-invalid={!!error}
              aria-describedby="ask-help"
            />
            <span id="ask-help" className={`block text-sm ${error ? 'text-danger' : 'text-muted'}`} role={error ? 'alert' : undefined}>
              {error || stoppedHelp || 'Muda só o que você pedir. Não gasta do limite do mês.'}
            </span>
          </label>
          <div className="space-y-1.5">
            <span className="label">
              Onde <span className="font-normal">(opcional)</span>
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Onde mudar">
              {ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={aspect === a}
                  disabled={busy || stopped}
                  onClick={() => setAspect(aspect === a ? null : a)}
                  className={`rounded-full border px-3 py-1 text-xs transition disabled:opacity-50 ${aspect === a ? 'border-accent bg-accent/20 text-fg' : 'border-line text-muted hover:text-fg'}`}
                >
                  {ASPECT_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={busy || stopped || !text.trim()} onClick={apply}>
              {phase === 'applying' ? <Spinner /> : null}
              {phase === 'applying' ? 'Aplicando…' : aspect === 'visual' ? 'Continuar' : 'Aplicar ajuste'}
            </button>
          </div>
        </>
      )}

      {(phase === 'result' || phase === 'undone') && (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost" disabled={busy} onClick={again}>
            Pedir outro ajuste
          </button>
        </div>
      )}

      {error && phase !== 'idle' && phase !== 'applying' && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
