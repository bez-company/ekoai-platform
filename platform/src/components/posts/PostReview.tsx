'use client';

// PostReview.tsx: o detalhe do post criado pela Ekoai (SPEC 012, tela Aprovar). O post na moldura do
// feed; a legenda editável; os atalhos de ajuste (uma chamada curta ao modelo) e "outra direção"
// (gera de novo e conta no limite); os fatos usados; recusar por aspecto; aprovar (no próximo
// horário livre, ou na fila quando a agenda não tem horário) e publicar agora. A foto do banco mandada
// para Aprovar por quem não aprova (Publicar foto, BEZ-254) abre aqui também: no formato dela (até
// 1.91:1), com os atalhos da legenda pela rota do post de foto e sem "outra direção" (não houve geração).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import FeedFrame, { type FeedRatio } from './FeedFrame';
import FeedbackForm from '@/components/FeedbackForm';
import { Spinner } from '@/components/auth/ui';
import { fmtDateTime } from '@/lib/format';
import { ratioOf } from '@/lib/media-view';
import type { PendingApproval } from '@/lib/types';
import type { RewriteMode } from '@/lib/agents';

type Fact = { id: string; kind: 'fact' | 'never'; text: string };

const SHORTCUTS: { mode: RewriteMode; label: string }[] = [
  { mode: 'shorter', label: 'Encurtar' },
  { mode: 'casual', label: 'Mais descontraído' },
  { mode: 'formal', label: 'Mais formal' },
  { mode: 'cta', label: 'Outro CTA' },
];

function splitCaption(text: string): { body: string; hashtags: string[] } {
  const lines = text.trim().split('\n');
  const last = lines[lines.length - 1] ?? '';
  const tags = last.match(/#[\p{L}\p{N}_]+/gu);
  if (tags && last.replace(/#[\p{L}\p{N}_]+/gu, '').trim() === '') return { body: lines.slice(0, -1).join('\n').trim(), hashtags: tags.map((t) => t.slice(1)) };
  return { body: text.trim(), hashtags: [] };
}

const RATIO_LABEL: Record<FeedRatio, string> = { '4:5': 'Retrato 4:5', '1:1': 'Quadrado 1:1', '1.91:1': 'Paisagem 1.91:1' };

const joinCaption = (body: string, hashtags: string[]) => (hashtags.length ? `${body.trim()}\n\n${hashtags.map((h) => `#${h}`).join(' ')}` : body.trim());

export default function PostReview({ pending, suggested, nextSlot, handle, accountName, usage, facts, canApprove, canEdit }: { pending: PendingApproval; suggested: string; nextSlot: string | null; handle: string; accountName: string; usage: { used: number; max: number }; facts: Fact[]; canApprove: boolean; canEdit: boolean }) {
  const router = useRouter();
  const initial = useMemo(() => splitCaption(suggested), [suggested]);
  const [body, setBody] = useState(initial.body);
  const [hashtags, setHashtags] = useState<string[]>(initial.hashtags);
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [directionAsked, setDirectionAsked] = useState(false);
  const [publishAsked, setPublishAsked] = useState(false);

  const image = pending.images?.find((i) => i.url)?.url ?? null;
  const kind = pending.post_kind ?? (pending.seed?.kind as string | undefined) ?? 'informativo';
  const title = pending.generation?.variations?.[0]?.hook ?? '';
  const flags = pending.generation?.guardrail_flags ?? [];
  const warning = flags.length ? pending.generation?.judge_reason : null;
  const briefId = pending.brief_id ?? null;
  const photoAssetId = pending.seed?.source === 'photo' && typeof pending.seed?.media_asset_id === 'string' ? pending.seed.media_asset_id : null;
  const ratio = ratioOf(pending.seed?.ratio);
  const caption = joinCaption(body, hashtags);
  const edited = caption !== suggested.trim();

  async function call(path: string, init?: RequestInit) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...init });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Não deu para concluir agora. Tente de novo.');
    return j;
  }

  async function shortcut(mode: RewriteMode) {
    if (!briefId && !photoAssetId) return;
    setBusy(mode);
    setError('');
    try {
      const j = photoAssetId
        ? await call('/api/photo-posts/rewrite', { body: JSON.stringify({ assetId: photoAssetId, mode, caption: body, hashtags }) })
        : await call(`/api/posts/${briefId}/caption`, { body: JSON.stringify({ mode, caption: body, hashtags }) });
      setBody(j.caption);
      if (Array.isArray(j.hashtags) && j.hashtags.length) setHashtags(j.hashtags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function anotherDirection() {
    if (!briefId) return;
    setBusy('direction');
    setError('');
    try {
      await call(`/api/posts/${briefId}/direction`);
      router.push(`/create/${briefId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  }

  async function approve(publishNow = false) {
    setBusy(publishNow ? 'publish' : 'approve');
    setError('');
    try {
      const j = await call('/api/approve', { body: JSON.stringify({ pendingId: pending.pending_id, captionId: 1, artId: 1, captionText: caption, publishNow }) });
      // Publicado vai para o Histórico; agendado, na fila ou com falha na publicação, para a Agenda.
      router.push(publishNow && j.published ? '/history' : '/calendar');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  }

  function addTag() {
    const tag = newTag.trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag && !hashtags.includes(tag)) setHashtags([...hashtags, tag]);
    setNewTag('');
  }

  const disabled = !!busy || !canEdit;

  return (
    <div className="space-y-4">
      <Link href="/inbox" className="text-sm text-muted hover:text-fg">
        ← Aprovar
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{title || 'Post'}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="chip">{photoAssetId ? 'Foto do banco' : kind === 'atmosfera' ? 'Atmosfera' : 'Informativo'}</span>
          <span className="chip">{RATIO_LABEL[ratio]}</span>
          <span>recebido {fmtDateTime(pending.saved_at)}</span>
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div>
          <FeedFrame handle={handle} accountName={accountName} imageUrl={image} caption={caption} ratio={ratio} />
        </div>

        <div className="space-y-4">
          {warning && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
              <strong>O revisor tem um aviso.</strong> {warning} Edite a legenda abaixo ou aprove assim.
            </div>
          )}

          <section className="card space-y-3">
            <h2 className="text-base font-semibold">Legenda</h2>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Texto da legenda</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} className="input resize-y" disabled={disabled} />
            </label>
            <p className="text-sm text-muted">
              {caption.length} de 2.200 caracteres{edited ? ' · editado' : ''}
              {edited && (
                <>
                  {' · '}
                  <button type="button" className="link" onClick={() => { setBody(initial.body); setHashtags(initial.hashtags); }}>
                    restaurar sugestão
                  </button>
                </>
              )}
            </p>
            <div className="space-y-1.5">
              <span className="text-sm font-semibold">Hashtags</span>
              <div className="flex flex-wrap items-center gap-2">
                {hashtags.map((h) => (
                  <span key={h} className="chip gap-1">
                    #{h}
                    {canEdit && (
                      <button type="button" aria-label={`Remover #${h}`} className="ml-1 text-muted hover:text-fg" onClick={() => setHashtags(hashtags.filter((x) => x !== h))}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {canEdit && (
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="+ Adicionar" aria-label="Nova hashtag" className="input w-36 py-1 text-xs" />
                )}
              </div>
            </div>
          </section>

          {canEdit && (briefId || photoAssetId) && (
            <section className="card space-y-3">
              <h2 className="text-base font-semibold">Ajustes rápidos</h2>
              <div className="flex flex-wrap gap-2">
                {SHORTCUTS.map((s) => (
                  <button key={s.mode} type="button" className="btn-ghost" disabled={!!busy} onClick={() => shortcut(s.mode)}>
                    {busy === s.mode ? <Spinner /> : null}
                    {s.label}
                  </button>
                ))}
                {briefId && (
                  <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => setDirectionAsked(true)}>
                    Outra direção
                  </button>
                )}
              </div>
              {directionAsked ? (
                <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
                  <p>
                    <strong>Outra direção gera o post de novo</strong> (outro ângulo e outro visual) e conta 1 no limite: {usage.used} de {usage.max} posts este mês. Este post sai da fila.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary" disabled={!!busy} onClick={anotherDirection}>
                      {busy === 'direction' ? 'Enviando…' : 'Gerar outra direção'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setDirectionAsked(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">{briefId ? 'Os atalhos mudam só a legenda, sem gastar do limite. Outra direção gera um post novo e conta 1.' : 'Os atalhos mudam só a legenda, sem gastar do limite. A foto fica como está.'}</p>
              )}
            </section>
          )}

          <section className="card space-y-2">
            <h2 className="text-base font-semibold">Fatos usados neste post</h2>
            {facts.length ? (
              <>
                <p className="text-sm text-muted">A Ekoai só afirma o que a empresa cadastrou.</p>
                <ul className="space-y-1 text-sm">
                  {facts.map((f) => (
                    <li key={f.id}>
                      {f.kind === 'never' ? <span className="chip mr-1">nunca</span> : null}
                      {f.text}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted">Nenhum fato cadastrado: o post não afirma número, preço nem prazo.</p>
            )}
            <Link href="/settings/facts" className="link text-sm">
              Ver os fatos da empresa
            </Link>
          </section>

          {error && <p className="text-sm text-danger" role="alert">{error}</p>}

          {rejecting && (
            <section className="card space-y-2 border-danger/30">
              <h2 className="text-base font-semibold">Recusar este post?</h2>
              <p className="text-sm text-muted">Diga o que não funcionou. A Ekoai aprende com o motivo e evita nos próximos posts.</p>
              <FeedbackForm mode="reject" channel={pending.channel} pendingId={pending.pending_id} excerpt={title} onCancel={() => setRejecting(false)} />
            </section>
          )}

          <section className="card space-y-2">
            {canApprove ? (
              <>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn-danger" disabled={!!busy || rejecting} onClick={() => setRejecting(true)}>
                    Recusar post
                  </button>
                  <button type="button" className="btn-ghost" disabled={!!busy || rejecting} onClick={() => setPublishAsked(true)}>
                    Publicar agora
                  </button>
                  <button type="button" className="btn-primary" disabled={!!busy || rejecting} onClick={() => approve()}>
                    {busy === 'approve' ? 'Aprovando…' : warning ? 'Aprovar mesmo assim' : nextSlot ? 'Aprovar e agendar' : 'Aprovar'}
                  </button>
                </div>
                {publishAsked && (
                  <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
                    <p>
                      <strong>Publicar agora no Instagram?</strong> O post vai ao ar em seguida, fora da agenda.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => setPublishAsked(false)}>
                        Cancelar
                      </button>
                      <button type="button" className="btn-primary" disabled={!!busy} onClick={() => approve(true)}>
                        {busy === 'publish' ? <Spinner /> : null}
                        {busy === 'publish' ? 'Publicando…' : 'Publicar agora'}
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-right text-sm text-muted">
                  {nextSlot ? (
                    `Entra no próximo horário livre: ${fmtDateTime(nextSlot)}.`
                  ) : (
                    <>
                      A agenda não tem horário livre: o post fica na fila e entra no primeiro horário que você criar.{' '}
                      <Link href="/calendar?edit=slots" className="link">
                        Criar horários
                      </Link>
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Só administradores aprovam nesta conta. Dê o seu parecer em "O que achou" ou peça a quem administra.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
