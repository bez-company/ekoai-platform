'use client';

// StudioExtras.tsx: o que fica embaixo do editor do Studio (SPEC 019, 024 e 027): "Pedir à Ekoai" (o pedido em texto livre sobre a
// imagem) e a lista de versões (ver, usar uma antiga sem apagar as outras). Cada Confirmar do editor e cada pedido gravam uma versão;
// quem muda a versão avisa o editor (`onChanged`) para ele recarregar a cena.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';
import Modal from '@/components/Modal';
import AskAdjust from '@/components/posts/AskAdjust';
import { fmtDateTime } from '@/lib/format';
import type { DesignState, RevisionView } from '@/lib/post-design-revisions';

type Conflict = { message: string; current: { version: number; summary: string; author: string | null } | null };

async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

export default function StudioExtras({
  briefId,
  state,
  usage,
  canEdit,
  slide,
  dirty,
  reloadKey,
  onChanged,
}: {
  briefId: string;
  state: DesignState;
  usage: { used: number; max: number };
  canEdit: boolean;
  slide?: number;
  dirty: boolean; // o editor tem mudança sem confirmar
  reloadKey: number; // sobe quando o editor grava: a lista de versões recarrega
  onChanged: () => void;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(state.version);
  const [versions, setVersions] = useState<RevisionView[]>(state.revisions);
  const [viewing, setViewing] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const editable = canEdit && !state.decided;

  const reload = useCallback(async () => {
    const r = await api(`/api/posts/${briefId}/design/revisions`).catch(() => null);
    if (!r?.ok) return setMessage('Não foi possível carregar as versões. Recarregue a página; nada foi alterado.');
    const s = r.body as unknown as DesignState;
    setVersion(s.version);
    setVersions(s.revisions);
    setConflict(null);
  }, [briefId]);
  useEffect(() => { if (reloadKey > 0) void reload(); }, [reloadKey, reload]);

  async function restore(v: number) {
    setBusy(`restore-${v}`);
    setMessage('');
    const r = await api(`/api/posts/${briefId}/design/revisions/${v}/restore`, { method: 'POST', body: JSON.stringify({ baseVersion: version }) }).catch(() => null);
    setBusy('');
    if (!r) return setMessage('Não foi possível voltar a essa versão. Tente de novo.');
    if (r.status === 409) return setConflict({ message: String(r.body.error ?? ''), current: (r.body.current as Conflict['current']) ?? null });
    if (!r.ok) return setMessage(String(r.body.error ?? 'Não foi possível voltar a essa versão. Tente de novo.'));
    setViewing(null);
    await reload();
    onChanged();
    router.refresh();
  }

  // "Visual novo" gera o post de novo (conta no limite): a mesma rota de Outra direção de Aprovar.
  async function anotherDirection() {
    setBusy('direction');
    const r = await api(`/api/posts/${briefId}/direction`, { method: 'POST' }).catch(() => null);
    if (r?.ok) return router.push(`/criar/${briefId}`);
    setBusy('');
    setMessage(r && r.status < 500 && r.body.error ? String(r.body.error) : 'Não foi possível gerar outra direção agora. Tente de novo.');
  }

  const seen = versions.find((v) => v.version === viewing) ?? null;

  return (
    <div className="min-w-0 space-y-4 px-4 pb-6">
      {!canEdit && !state.decided && (
        <div className="mx-auto max-w-[620px] rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <strong>Você acompanha esta conta como leitor.</strong> Dá para ver as versões do post; quem edita ou administra muda a imagem.
        </div>
      )}
      {state.decided && (
        <div className="mx-auto max-w-[620px] rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <strong>Este post já foi decidido ou usa a sua foto como está.</strong> Para mudar a imagem, peça outra direção e crie um post novo. As versões abaixo ficam só para consulta.
        </div>
      )}
      {message && <p className="mx-auto max-w-[620px] rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">{message}</p>}
      {conflict && (
        <div className="mx-auto max-w-[620px] space-y-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
          <p><strong>{conflict.message}</strong></p>
          <button type="button" className="btn-primary" onClick={() => { void reload(); onChanged(); }}>Abrir a versão {conflict.current?.version ?? 'atual'}</button>
        </div>
      )}

      {editable && slide === undefined && (
        <section className="card mx-auto max-w-[620px] space-y-3" aria-label="Pedir à Ekoai">
          <h2 className="text-base font-semibold">Pedir à Ekoai</h2>
          <AskAdjust
            briefId={briefId}
            version={version}
            body=""
            hashtags={[]}
            usage={usage}
            aspects={['text', 'layout']}
            blockedReason={dirty ? 'Confirme ou descarte as mudanças da imagem antes de pedir um ajuste.' : null}
            busyElsewhere={busy !== ''}
            onCaption={() => undefined}
            onChanged={() => { void reload(); onChanged(); router.refresh(); }}
            onDirection={() => void anotherDirection()}
          />
        </section>
      )}

      <section className="card mx-auto max-w-[620px] space-y-3" aria-label="Versões">
        <div>
          <h2 className="text-base font-semibold">Versões</h2>
          <p className="mt-1 text-sm text-muted">Cada Confirmar salva uma versão com o que mudou e quem mudou. A que está em uso é a que será aprovada. Voltar a uma versão antiga cria uma versão nova e não apaga as outras (no máximo 20 por post).</p>
        </div>
        {versions.length < 2 && <p className="rounded-lg bg-inset px-3 py-2 text-sm">Esta é a versão inicial. Faça um ajuste e confirme para salvar a versão 2.</p>}
        <ul className="divide-y divide-line">
          {versions.map((v) => {
            const inUse = v.version === version;
            return (
              <li key={v.version} className="flex items-center gap-3 py-3">
                <span className="block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line bg-inset">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/posts/${briefId}/design/revisions/${v.version}/png`} alt="" loading="lazy" className="block h-full w-full object-cover" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <strong>{v.version === 1 ? 'Versão inicial' : `Versão ${v.version}`}</strong>
                    {inUse && <span className="chip text-success">Em uso</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {v.summary} · {v.author ?? (v.version === 1 ? 'Ekoai' : 'Equipe')}
                    {v.createdAt ? `, ${fmtDateTime(v.createdAt)}` : ''}
                  </p>
                </div>
                {!inUse && <button type="button" className="btn-ghost" onClick={() => setViewing(v.version)}>Ver</button>}
              </li>
            );
          })}
        </ul>
      </section>

      {seen && (
        <Modal title={seen.version === 1 ? 'Versão inicial' : `Versão ${seen.version}`} onClose={() => setViewing(null)}>
          <p className="text-sm text-muted">A versão {version} continua em uso e é a que será aprovada. {seen.summary}.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/posts/${briefId}/design/revisions/${seen.version}/png`} alt={`Imagem da versão ${seen.version}`} className="mx-auto block max-h-[60vh] w-auto rounded-md border border-line" />
          <div className="flex flex-wrap justify-end gap-2">
            {editable && (
              <button type="button" className="btn-primary" disabled={busy !== '' || dirty} onClick={() => void restore(seen.version)}>
                {busy === `restore-${seen.version}` ? <Spinner /> : null}
                Usar esta versão
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => setViewing(null)}>Fechar</button>
          </div>
          {dirty && <p className="text-xs text-muted">Confirme ou descarte as mudanças do editor antes de trocar de versão.</p>}
        </Modal>
      )}
    </div>
  );
}
