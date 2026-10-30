'use client';

// PostReview.tsx: o detalhe do post criado pela Ekoai (SPEC 012, tela Aprovar). O post na moldura do
// feed; a legenda editável; os atalhos de ajuste (uma chamada curta ao modelo) e "outra direção"
// (gera de novo e conta no limite); os fatos usados; recusar por aspecto; aprovar (no próximo
// horário livre, ou na fila quando a agenda não tem horário) e publicar agora. A foto do banco mandada
// para Aprovar por quem não aprova (Publicar foto, BEZ-254) abre aqui também: no formato dela (até
// 1.91:1), com os atalhos da legenda pela rota do post de foto e sem "outra direção" (não houve geração).

import { useMemo, useState } from 'react';
import { useInjectedText, useTextDraft } from './approve-draft';
import { splitHashtagLine } from '@/lib/signal-text';
import Link from 'next/link';
import { levelOf } from '@/lib/studio/levels';
import StudioMarks from '@/components/posts/studio/StudioMarks';
import StudioOptions from '@/components/posts/studio/StudioOptions';
import StudioRetry from '@/components/posts/studio/StudioRetry';
import { useRouter } from 'next/navigation';
import FeedFrame, { type FeedRatio } from './FeedFrame';
import ProfileGrid from './ProfileGrid';
import { SlideList, SlideStrip } from './CarouselSlides';
import FormatSwitch from './FormatSwitch';
import { carouselOf } from '@/lib/carousel-view';
import AskAdjust from './AskAdjust';
import RequestPanel from './RequestPanel';
import { requestPanelOf } from '@/lib/request-panel';
import FeedbackForm from '@/components/FeedbackForm';
import { Spinner } from '@/components/auth/ui';
import { fmtDateTime } from '@/lib/format';
import { ratioOf } from '@/lib/media-view';
import type { PendingApproval } from '@/lib/types';
import type { RewriteMode } from '@/lib/agents';
import type { DesignState } from '@/lib/post-design-revisions';

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

export type DesignProps = { state: DesignState };

export default function PostReview({ pending, suggested, nextSlot, handle, accountName, usage, facts, canApprove, canEdit, canManage = false, design = null }: { pending: PendingApproval; suggested: string; nextSlot: string | null; handle: string; accountName: string; usage: { used: number; max: number }; facts: Fact[]; canApprove: boolean; canEdit: boolean; canManage?: boolean; design?: DesignProps | null }) {
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
  // A versão do design em uso: aprovar leva esta versão e para se outra pessoa salvou uma nova (SPEC 019).
  const [designVersion, setDesignVersion] = useState<number | undefined>(design?.state.version);
  // Feed ou Grade (SPEC 023): a mesma imagem vista na moldura do feed ou entre os últimos posts do perfil.
  const [preview, setPreview] = useState<'feed' | 'grid'>('feed');
  const [showCropGuide, setShowCropGuide] = useState(false);
  // Carrossel (SPEC 023): as lâminas e a que está à mostra.
  const carousel = useMemo(() => carouselOf(pending), [pending]);
  const [slide, setSlide] = useState(0);
  // O que a pessoa pediu sobre a imagem e o que foi aplicado (SPEC 020): antes da legenda.
  const requestPanel = useMemo(() => requestPanelOf(pending), [pending]);

  const image = pending.images?.find((i) => i.url)?.url ?? null;
  const kind = pending.post_kind ?? (pending.seed?.kind as string | undefined) ?? 'informativo';
  const title = pending.generation?.variations?.[0]?.hook ?? '';
  const flags = pending.generation?.guardrail_flags ?? [];
  const warning = flags.length ? pending.generation?.judge_reason : null;
  const studioFallback = pending.generation?.studio_fallback ?? null;
  const briefId = pending.brief_id ?? null;
  const photoAssetId = pending.seed?.source === 'photo' && typeof pending.seed?.media_asset_id === 'string' ? pending.seed.media_asset_id : null;
  const ratio = ratioOf(pending.seed?.ratio);
  // Horário pedido por quem mandou a foto para Aprovar (BEZ-256). Já passou: aprovar cai no próximo livre.
  const requestedRaw = typeof pending.seed?.requested_for === 'string' ? pending.seed.requested_for : null;
  const requested = requestedRaw && Number.isFinite(Date.parse(requestedRaw)) ? requestedRaw : null;
  const requestedPast = requested !== null && Date.parse(requested) <= Date.now();
  const caption = joinCaption(body, hashtags);
  const edited = caption !== suggested.trim();
  useTextDraft(pending.pending_id, edited ? caption : null, designVersion, caption);
  // O painel de potencial aplica uma sugestão (ou desfaz): só o texto da legenda muda, as hashtags ficam como estão.
  useInjectedText(pending.pending_id, (text) => setBody(splitHashtagLine(text).body));

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
      router.push(`/criar/${briefId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  }

  async function approve(publishNow = false) {
    setBusy(publishNow ? 'publish' : 'approve');
    setError('');
    try {
      const j = await call('/api/approve', { body: JSON.stringify({ pendingId: pending.pending_id, captionId: 1, artId: 1, captionText: caption, publishNow, ...(designVersion ? { designVersion } : {}) }) });
      // Publicado vai para o Histórico; agendado, na fila ou com falha na publicação, para a Agenda.
      router.push(publishNow && j.published ? '/historico' : '/agenda');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  }

  // O pedido de ajuste gravou (ou desfez) uma versão: a página traz o PNG novo e o aprovar passa a levar a versão atual.
  function designChanged(version: number) {
    setDesignVersion(version);
    router.refresh();
  }

  function addTag() {
    const tag = newTag.trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag && !hashtags.includes(tag)) setHashtags([...hashtags, tag]);
    setNewTag('');
  }

  const disabled = !!busy || !canEdit;

  return (
    <div className="space-y-4">
      <Link href="/aprovar" className="text-sm text-muted hover:text-fg">
        ← Aprovar
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{title || 'Post'}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="chip">{photoAssetId ? 'Foto do banco' : kind === 'atmosfera' ? 'Atmosfera' : 'Informativo'}</span>
          <span className="chip">{RATIO_LABEL[ratio]}</span>
          {requested && <span className="chip">Pedido para {fmtDateTime(requested)}</span>}
          <span>recebido {fmtDateTime(pending.saved_at)}</span>
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div>
          <div role="tablist" aria-label="Como ver o post" className="mb-3 inline-flex gap-1 rounded-full border border-line bg-inset p-0.5 text-sm">
            {([['feed', 'Feed'], ['grid', 'Grade']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={preview === id} onClick={() => setPreview(id)} className={`rounded-full px-4 py-1 font-semibold ${preview === id ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
                {label}
              </button>
            ))}
          </div>
          {preview === 'feed' ? (
            <>
              <FeedFrame handle={handle} accountName={accountName} imageUrl={image} caption={caption} ratio={ratio} cropGuide={showCropGuide} slides={carousel?.slides.map((s) => s.url)} slide={slide} onSlide={setSlide} />
              {carousel && <SlideStrip view={carousel} current={slide} onSelect={setSlide} />}
              <label className="mt-3 flex max-w-[420px] items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={showCropGuide} onChange={(e) => setShowCropGuide(e.target.checked)} />
                Mostrar o corte da grade sobre o post
              </label>
            </>
          ) : (
            <ProfileGrid newImageUrl={image} newIsCarousel={!!carousel} handle={handle} accountName={accountName} />
          )}
        </div>

        <div className="space-y-4">
          {studioFallback && (
            <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
              <p>
                <strong>Este post saiu no Rápido, e não no {levelOf(studioFallback.from).name} que você pediu.</strong> O estúdio tentou mais de uma vez e parou por este motivo: {studioFallback.reason ?? 'não conseguiu concluir a peça'}. O Rápido é o último recurso, e o {levelOf(studioFallback.from).name} não entra no seu consumo.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {briefId && <StudioRetry briefId={briefId} levelName={levelOf(studioFallback.from).name} />}
                <Link href="/criar" className="btn-ghost inline-flex">
                  Mudar o pedido
                </Link>
              </div>
            </div>
          )}

          {warning && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
              <strong>O revisor tem um aviso.</strong> {warning} Edite a legenda abaixo ou aprove assim.
            </div>
          )}

          {carousel && <SlideList view={carousel} current={slide} onSelect={setSlide} />}

          {design && briefId && (
            <section className="card space-y-3" aria-label="Imagem do post">
              <div>
                <h2 className="text-base font-semibold">{carousel ? `Lâmina ${slide + 1} de ${carousel.slides.length}` : 'Imagem'}</h2>
                <p className="mt-1 text-sm text-muted">
                  {design.state.revisions[0] ? `${design.state.version === 1 ? 'Versão inicial' : `Versão ${design.state.version}`} em uso: ${design.state.revisions[0].summary}.` : 'Versão inicial em uso.'} Texto, cor, logo e layout mudam sem gerar de novo e sem gastar do limite do mês ({usage.used} de {usage.max}).
                </p>
              </div>
              <Link href={`/aprovar/${encodeURIComponent(pending.pending_id)}/studio${carousel ? `?lamina=${slide + 1}` : ''}`} className="btn-primary">
                {canEdit && !design.state.decided ? (carousel ? 'Editar esta lâmina' : 'Editar imagem') : 'Ver versões'}
              </Link>
            </section>
          )}

          {canEdit && design && briefId && designVersion !== undefined && !design.state.decided && !pending.seed?.photo_usage && (
            <FormatSwitch
              briefId={briefId}
              version={designVersion}
              slides={carousel?.slides.length ?? 0}
              blockedReason={null}
              disabled={!!busy}
              onChanged={(v) => {
                setSlide(0);
                designChanged(v);
              }}
            />
          )}

          {pending.generation?.studio?.options && pending.generation.studio.options.length > 1 && <StudioOptions pendingId={pending.pending_id} studio={pending.generation.studio} />}
          {pending.generation?.studio?.marks && <StudioMarks pendingId={pending.pending_id} marks={pending.generation.studio.marks} />}

          {requestPanel && <RequestPanel panel={requestPanel} onAskAdjust={() => document.getElementById('pedir-ajuste')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />}

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
            <section className="card space-y-3" id="pedir-ajuste">
              <h2 className="text-base font-semibold">{design && briefId && !carousel ? 'Pedir ajuste' : 'Ajustes rápidos'}</h2>
              {design && briefId && !carousel && designVersion !== undefined && (
                <AskAdjust
                  briefId={briefId}
                  version={designVersion}
                  body={body}
                  hashtags={hashtags}
                  usage={usage}
                  blockedReason={null}
                  busyElsewhere={!!busy}
                  onCaption={(b, h) => {
                    setBody(b);
                    setHashtags(h);
                  }}
                  onChanged={designChanged}
                  onDirection={anotherDirection}
                />
              )}
              {design && briefId && !carousel && <span className="label block border-t border-line pt-3">Atalhos</span>}
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
            <Link href="/configuracoes/fatos" className="link text-sm">
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
                    {busy === 'approve' ? 'Aprovando…' : warning ? 'Aprovar mesmo assim' : (requested && !requestedPast) || nextSlot ? 'Aprovar e agendar' : 'Aprovar'}
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
                  {requested && !requestedPast ? (
                    `Entra no horário pedido: ${fmtDateTime(requested)}.`
                  ) : requested && requestedPast ? (
                    `O horário pedido (${fmtDateTime(requested)}) já passou. ${nextSlot ? `Entra no próximo horário livre: ${fmtDateTime(nextSlot)}.` : 'O post fica na fila até ter horário na agenda.'}`
                  ) : nextSlot ? (
                    `Entra no próximo horário livre: ${fmtDateTime(nextSlot)}.`
                  ) : (
                    <>
                      A agenda não tem horário livre: o post fica na fila e entra no primeiro horário que você criar.{' '}
                      <Link href="/agenda?edit=slots" className="link">
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
