'use client';

// Aprovação por ideia (SPEC 003 R3): uma tela com todas as redes da mesma rodada. Cada rede
// liga ou desliga, escolhe variação, legenda, arte e horário; dá para pedir post próprio ou
// readaptar a partir de outra variação do conteúdo-mãe.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDateTime, isoToLocalInput, localInputToIso } from '@/lib/format';
import { splitThread } from '@/lib/thread';
import { roleOf, type Idea } from '@/lib/ideas-model';
import type { PendingApproval } from '@/lib/types';

type NetState = {
  enabled: boolean;
  captionId: number;
  artId: number;
  captionText: string;
  edited: boolean;
  when: 'slot' | 'manual';
  manual: string;
  noImage: boolean; // texto puro (SPEC 005); o Instagram exige imagem
};

function textOnlyByDefault(p: PendingApproval, captionId: number): boolean {
  if (p.channel === 'instagram') return false;
  const format = p.generation?.variations?.find((v) => v.id === captionId)?.format as string | undefined;
  return format === 'text' || !(p.images || []).some((i) => i.url);
}

const ROLE_LABEL = { mother: 'Conteúdo-mãe', own: 'Post próprio', single: 'Post avulso' } as const;

function initialState(p: PendingApproval, suggested: Record<number, string>, nextSlot: string | null): NetState {
  const variations = p.generation?.variations || [];
  const captionId = p.top_id ?? variations[0]?.id ?? 1;
  const images = p.images || [];
  return {
    enabled: true,
    captionId,
    artId: images.find((i) => i.id === captionId && i.url)?.id ?? images.find((i) => i.url)?.id ?? captionId,
    captionText: suggested[captionId] ?? '',
    edited: false,
    when: nextSlot ? 'slot' : 'manual',
    manual: nextSlot ? isoToLocalInput(nextSlot) : '',
    noImage: textOnlyByDefault(p, captionId),
  };
}

export default function IdeaForm({
  idea,
  suggested,
  nextSlots,
}: {
  idea: Idea;
  suggested: Record<string, Record<number, string>>;
  nextSlots: Record<string, string | null>;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, NetState>>(() =>
    Object.fromEntries(
      idea.pendings.map((p) => [p.pending_id, initialState(p, suggested[p.pending_id] || {}, nextSlots[p.channel] ?? null)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const mother = idea.pendings.find((p) => roleOf(p) === 'mother') || null;
  const reuseSiblings = idea.pendings.filter((p) => roleOf(p) === 'reuse');
  const enabledCount = Object.values(state).filter((s) => s.enabled).length;
  const motherChoice = mother ? state[mother.pending_id]?.captionId : null;
  const motherChanged = !!mother && motherChoice !== (mother.top_id ?? null);

  function patch(pendingId: string, change: Partial<NetState>) {
    setState((prev) => ({ ...prev, [pendingId]: { ...prev[pendingId], ...change } }));
  }

  async function post(url: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError('');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(j.error || 'Não deu certo. Tente de novo.');
    return res.ok;
  }

  async function approve() {
    const items = idea.pendings.map((p) => {
      const s = state[p.pending_id];
      return {
        pendingId: p.pending_id,
        enabled: s.enabled,
        captionId: s.captionId,
        artId: s.artId,
        noImage: s.noImage,
        captionText: s.captionText,
        scheduledFor: s.when === 'manual' && s.manual ? localInputToIso(s.manual) : undefined,
      };
    });
    if (await post('/api/ideas/approve', { briefId: idea.briefId, items })) {
      router.push('/agenda');
      router.refresh();
    }
  }

  async function reject() {
    if (await post('/api/ideas/reject', { briefId: idea.briefId, reason })) {
      router.push('/aprovar');
      router.refresh();
    }
  }

  async function rework(targets: PendingApproval[], mode: 'own' | 'reuse', sourceVariationId?: number) {
    let ok = true;
    for (const p of targets) ok = (await post('/api/ideas/rework', { pendingId: p.pending_id, mode, sourceVariationId })) && ok;
    if (ok) {
      setNotice('Pedido registrado. A nova versão chega no próximo ciclo de geração (a cada 10 min, das 17h às 23h).');
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Aprovar ideia</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {mother?.generation?.pillar && <span className="chip">{mother.generation.pillar}</span>}
          {mother?.generation?.angle && <span className="chip">{mother.generation.angle}</span>}
          <span className="chip">{idea.pendings.length} redes</span>
        </div>
      </div>

      {motherChanged && reuseSiblings.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-warning/30 bg-warning/10 text-sm text-warning">
          <span className="flex-1">
            Você trocou a variação do conteúdo-mãe. As redes reaproveitadas ainda vêm da variação #{mother?.top_id}.
          </span>
          <button onClick={() => rework(reuseSiblings, 'reuse', motherChoice ?? undefined)} disabled={busy} className="btn-ghost">
            Readaptar a partir da #{motherChoice}
          </button>
        </div>
      )}

      {idea.pendings.map((p) => (
        <NetworkCard
          key={p.pending_id}
          p={p}
          s={state[p.pending_id]}
          suggested={suggested[p.pending_id] || {}}
          nextSlot={nextSlots[p.channel] ?? null}
          motherChannel={mother?.channel ?? null}
          busy={busy}
          onChange={(c) => patch(p.pending_id, c)}
          onRework={(mode) => rework([p], mode, mode === 'reuse' ? motherChoice ?? undefined : undefined)}
        />
      ))}

      {idea.absent.length > 0 && (
        <div className="card space-y-1 text-sm text-muted">
          {idea.absent.map((a) => (
            <p key={a.channel}>
              <span className="chip uppercase">{a.channel}</span>{' '}
              {a.mode === 'locked' ? `Travado: ${a.reason || 'rede não publica ainda'}.` : 'Pulado nesta ideia: o formato não combina com a rede.'}
            </p>
          ))}
        </div>
      )}

      {notice && <p className="text-sm text-success">{notice}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {rejecting && (
        <section className="card space-y-2 border-danger/30">
          <h2 className="label">Por que rejeitar a ideia?</h2>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex.: tema repetido da semana passada"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button onClick={reject} disabled={busy} className="btn-danger">
              Rejeitar todas as redes
            </button>
            <button onClick={() => setRejecting(false)} disabled={busy} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </section>
      )}

      <div className="flex gap-2 border-t border-line pt-4">
        <button onClick={approve} disabled={busy || enabledCount === 0} className="btn-primary">
          {busy ? 'Salvando…' : `Aprovar e agendar ${enabledCount} ${enabledCount === 1 ? 'rede' : 'redes'}`}
        </button>
        <button onClick={() => setRejecting(true)} disabled={busy || rejecting} className="btn-danger">
          Rejeitar ideia
        </button>
      </div>
    </div>
  );
}

function NetworkCard({
  p,
  s,
  suggested,
  nextSlot,
  motherChannel,
  busy,
  onChange,
  onRework,
}: {
  p: PendingApproval;
  s: NetState;
  suggested: Record<number, string>;
  nextSlot: string | null;
  motherChannel: string | null;
  busy: boolean;
  onChange: (c: Partial<NetState>) => void;
  onRework: (mode: 'own' | 'reuse') => void;
}) {
  const role = roleOf(p);
  const variations = p.generation?.variations || [];
  const images = (p.images || []).filter((i) => i.url);
  const chosen = variations.find((v) => v.id === s.captionId);
  const tweets = useMemo(() => (p.channel === 'twitter' ? splitThread(s.captionText) : []), [p.channel, s.captionText]);
  const from = (p.generation as { reuse?: { from_channel?: string } } | undefined)?.reuse?.from_channel;
  const roleLabel = role === 'reuse' ? `Reaproveitado do ${from}` : ROLE_LABEL[role];
  const slides = (chosen as { slideUrls?: string[] } | undefined)?.slideUrls;

  return (
    <section className={`card space-y-3 ${s.enabled ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip uppercase">{p.channel}</span>
        <span className="text-sm">{roleLabel}</span>
        {p.status === 'rework_requested' && <span className="chip text-warning">nova versão pedida</span>}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Publicar nesta rede
        </label>
      </div>

      {s.enabled && (
        <>
          {variations.length > 1 && (
            <div className="grid gap-2 md:grid-cols-3">
              {variations.map((v) => (
                <button
                  key={v.id}
                  onClick={() =>
                    onChange({
                      captionId: v.id,
                      noImage: textOnlyByDefault(p, v.id),
                      ...(s.edited ? {} : { captionText: suggested[v.id] ?? '' }),
                    })
                  }
                  className={`rounded-lg border p-3 text-left text-sm transition ${
                    s.captionId === v.id ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">#{v.id}</span>
                    <span className="chip">{v.format || 'single'}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-muted">{v.hook}</p>
                </button>
              ))}
            </div>
          )}

          <textarea
            value={s.captionText}
            onChange={(e) => onChange({ captionText: e.target.value, edited: true })}
            rows={p.channel === 'linkedin' ? 10 : 6}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <p className="text-xs text-muted">
            {s.captionText.length} caracteres{s.edited ? ' · editado' : ''}
            {slides?.length ? ` · carrossel de ${slides.length} slides` : ''}
          </p>

          {tweets.length > 0 && (
            <ol className="space-y-1">
              {tweets.map((t, i) => (
                <li key={i} className="rounded-md border border-line px-3 py-2 text-sm">
                  <p className="whitespace-pre-line">{t}</p>
                  <p className="mt-1 text-right text-xs text-muted">{t.length}/280</p>
                </li>
              ))}
            </ol>
          )}

          {(images.length > 0 || p.channel !== 'instagram') && (
            <div className="flex flex-wrap gap-2">
              {p.channel !== 'instagram' && (
                <button
                  onClick={() => onChange({ noImage: true })}
                  className={`flex h-24 w-24 items-center justify-center rounded-lg border text-xs ${
                    s.noImage ? 'border-accent ring-1 ring-accent' : 'border-line text-muted'
                  }`}
                >
                  Sem imagem
                </button>
              )}
              {images.map((im) => (
                <button
                  key={im.id}
                  onClick={() => onChange({ artId: im.id, noImage: false })}
                  className={`overflow-hidden rounded-lg border ${!s.noImage && s.artId === im.id ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url!} alt={`arte ${im.id}`} className="h-24 w-24 object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onChange({ when: 'slot' })} disabled={!nextSlot} className={s.when === 'slot' ? 'btn-primary' : 'btn-ghost'}>
              {nextSlot ? `Próximo slot · ${fmtDateTime(nextSlot)}` : 'Sem slot livre'}
            </button>
            <button onClick={() => onChange({ when: 'manual' })} className={s.when === 'manual' ? 'btn-primary' : 'btn-ghost'}>
              Horário manual
            </button>
            {s.when === 'manual' && (
              <input
                type="datetime-local"
                value={s.manual}
                onChange={(e) => onChange({ manual: e.target.value })}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            )}
          </div>

          {(role === 'reuse' || (role === 'own' && motherChannel)) && (
            <div className="border-t border-line pt-2">
              {role === 'reuse' ? (
                <button onClick={() => onRework('own')} disabled={busy} className="text-xs text-muted hover:text-fg hover:underline">
                  Não serve? Gerar um post próprio para {p.channel}
                </button>
              ) : (
                <button onClick={() => onRework('reuse')} disabled={busy} className="text-xs text-muted hover:text-fg hover:underline">
                  Reaproveitar o conteúdo do {motherChannel} em vez deste
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
