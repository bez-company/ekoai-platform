'use client';

import { useEffect, useState } from 'react';
import { injectText, useDraftState } from './approve-draft';
import { criticFromStored, type Band, type Critic, type Criterion, type Score } from '@/lib/signal-critic';
import { joinHashtagLine, splitHashtagLine } from '@/lib/signal-text';

// O potencial do post na rede (SPEC 028, BEZ-425 e BEZ-441): faixa e checklist, nunca uma nota que pareça da rede. Cada critério mostra o
// trecho do post que o prova (entre aspas) ou o que falta, e a sugestão de quem avaliou, com "Aplicar" (reescreve só aquele ponto).
// "Avaliar de novo" confere o texto que está na tela depois de uma edição. Nada disto gasta do limite de posts nem muda o post guardado.
const BAND: Record<Band, { label: string; tone: string }> = {
  forte: { label: 'Forte', tone: 'border-success/40 text-success' },
  medio: { label: 'Médio', tone: 'border-warning/40 text-warning' },
  fraco: { label: 'Fraco', tone: 'border-danger/40 text-danger' },
};
const SCORE_BAND: Record<Score, Band> = { 2: 'forte', 1: 'medio', 0: 'fraco' };
const NAME = { instagram: 'Instagram', linkedin: 'LinkedIn' } as const;

type Applied = { previousText: string; previousCritic: Critic | null; previousBody: string | null };

export default function SignalPanel({ pendingId, channel, stored, canEdit = false }: { pendingId: string; channel: string; stored: unknown; canEdit?: boolean }) {
  const [critic, setCritic] = useState<Critic | null>(() => criticFromStored(stored));
  const [evaluatedBody, setEvaluatedBody] = useState<string | null>(null);
  const [busy, setBusy] = useState<'evaluate' | string | null>(null);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState<Applied | null>(null);
  const current = useDraftState().current[pendingId];
  const body = current === undefined ? null : splitHashtagLine(current).body.trim();

  // O texto que a avaliação guardada leu é o que a aba mostrava quando abriu.
  useEffect(() => {
    if (evaluatedBody === null && body !== null) setEvaluatedBody(body);
  }, [body, evaluatedBody]);

  if (channel !== 'instagram' && channel !== 'linkedin') return null;
  const name = NAME[channel];
  const stale = critic !== null && body !== null && evaluatedBody !== null && body !== evaluatedBody;

  async function call(payload: Record<string, unknown>): Promise<{ critic: Critic; text: string | null } | null> {
    setError('');
    try {
      const res = await fetch(`/api/pendings/${encodeURIComponent(pendingId)}/signal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: current, ...payload }) });
      const data = (await res.json().catch(() => ({}))) as { critic?: unknown; text?: string | null; error?: string };
      const next = criticFromStored(data.critic);
      if (!res.ok || !next) {
        setError(data.error ?? 'Não deu para avaliar agora. Tente de novo.');
        return null;
      }
      return { critic: next, text: typeof data.text === 'string' ? data.text : null };
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
      return null;
    }
  }

  async function evaluate() {
    if (current === undefined) return;
    setBusy('evaluate');
    const out = await call({ action: 'evaluate' });
    setBusy(null);
    if (!out) return;
    setCritic(out.critic);
    setEvaluatedBody(body);
    setApplied(null);
  }

  async function apply(c: Criterion) {
    if (current === undefined || !c.suggestion) return;
    setBusy(c.id);
    const out = await call({ action: 'apply', criterionId: c.id, suggestion: c.suggestion });
    setBusy(null);
    if (!out || out.text === null) return;
    const tags = splitHashtagLine(current).tags;
    setApplied({ previousText: current, previousCritic: critic, previousBody: evaluatedBody });
    injectText(pendingId, joinHashtagLine(out.text, tags));
    setCritic(out.critic);
    setEvaluatedBody(out.text.trim());
  }

  function undo() {
    if (!applied) return;
    injectText(pendingId, applied.previousText);
    setCritic(applied.previousCritic);
    setEvaluatedBody(applied.previousBody);
    setApplied(null);
  }

  if (busy === 'evaluate' && !critic) {
    return (
      <section className="card space-y-2" aria-busy="true" aria-label={`Potencial no ${name}`}>
        <h2 className="text-base font-semibold">Potencial no {name}</h2>
        <p className="text-sm text-muted">Conferindo o post contra o que o {name} mede. Leva alguns segundos.</p>
      </section>
    );
  }

  if (!critic) {
    return (
      <section className="card space-y-2" aria-label={`Potencial no ${name}`}>
        <h2 className="text-base font-semibold">Potencial no {name}</h2>
        <p className="text-sm text-muted">{error || 'Ainda sem avaliação. O post está pronto e você pode aprovar sem ela.'}</p>
        {canEdit && current !== undefined && (
          <button type="button" className="btn-ghost" onClick={() => void evaluate()} disabled={busy !== null}>
            {busy === 'evaluate' ? 'Avaliando…' : error ? 'Avaliar de novo' : 'Avaliar este post'}
          </button>
        )}
      </section>
    );
  }

  const weak = critic.criteria.filter((c) => c.score < 2).length;
  return (
    <section className="card space-y-3" aria-label={`Potencial no ${name}`} aria-busy={busy !== null}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Potencial no {name}</h2>
        <span className={`chip ${BAND[critic.band].tone}`}>{BAND[critic.band].label}</span>
        <span className="text-sm text-muted">{weak ? `${weak} ${weak === 1 ? 'ponto' : 'pontos'} para melhorar` : 'Nenhum ponto fraco'}</span>
        {canEdit && (
          <button type="button" className="btn-ghost ml-auto" onClick={() => void evaluate()} disabled={busy !== null}>
            {busy === 'evaluate' ? 'Avaliando…' : 'Avaliar de novo'}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">Estimativa da Ekoai a partir do que o {name} diz medir. Não é a nota da rede.</p>
      {stale && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm" role="status">
          Você mudou o texto depois desta avaliação. Avalie de novo para conferir o que mudou.
        </p>
      )}
      {applied && (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm" role="status">
          <span>
            <strong>Sugestão aplicada.</strong> Só o texto mudou. Não conta como post novo no limite.
          </span>
          <button type="button" className="btn-ghost" onClick={undo}>
            Desfazer
          </button>
        </p>
      )}
      {!applied && critic.fixed && <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">A Ekoai já ajustou o texto para melhorar este ponto antes de mostrar o post.</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-line">
        {critic.criteria.map((c) => {
          const band = BAND[SCORE_BAND[c.score]];
          return (
            <li key={c.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{c.label}</strong>
                <span className={`chip ${band.tone}`}>{band.label}</span>
              </div>
              {c.evidence && <p className="text-sm text-muted">{c.score > 0 ? `"${c.evidence}"` : c.evidence}</p>}
              {c.suggestion && c.score < 2 && (
                <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line bg-inset px-3 py-2 text-sm">
                  <p className="min-w-0 flex-1">
                    <strong>Sugestão:</strong> {c.suggestion}
                  </p>
                  {canEdit && (
                    <button type="button" className="btn-ghost" onClick={() => void apply(c)} disabled={busy !== null || current === undefined}>
                      {busy === c.id ? 'Aplicando…' : 'Aplicar'}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
