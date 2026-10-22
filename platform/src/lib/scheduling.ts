// scheduling.ts: ações de aprovação/agendamento (lado escrita). Aprovar uma pendência vira
// um scheduled_post: no próximo horário livre, na fila sem horário (status 'queued') quando a
// agenda não tem horário, ou na hora quando a pessoa pede "Publicar agora" (a rota chama o
// publishNow). Cancelar/reagendar mexem na fila.

import type { TenantDb } from './tenant-db';
import { notify, channelName } from './notifications';
import { composeCaption } from './caption';
import { nextFreeSlot } from './slots';
import { distributionUtm } from './utm';
import { splitThread } from './thread';
import type { Channel, PendingApproval, Variation, ImageRef, MediaKind } from './types';
import { UserError } from './errors';

const NOT_FOUND = 'Post agendado não encontrado, ou já mudou de estado. Recarregue a página.';

function fmtLocal(iso: string): string {
  const offset = Number(process.env.PUBLISH_TZ_OFFSET ?? -3);
  const d = new Date(new Date(iso).getTime() + offset * 3600 * 1000);
  const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dias[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

async function loadPending(t: TenantDb, pendingId: string): Promise<PendingApproval | null> {
  const { data, error } = await t.select('pending_approvals').eq('pending_id', pendingId).limit(1);
  if (error) throw new Error(`Falha ao ler pending: ${error.message}`);
  return (data?.[0] as PendingApproval) ?? null;
}

export function mediaKindOf(channel: string, variation: Variation, imageUrl: string | null, caption = ''): MediaKind {
  if (channel === 'twitter') return splitThread(caption).length > 1 ? 'thread' : imageUrl ? 'image' : 'text';
  if (channel === 'linkedin' && variation.documentUrl) return 'document';
  // carrossel sem slides renderizados sai como imagem única no publish
  if (variation.format === 'carousel' && (variation.slideUrls?.length ?? 0) >= 2) return 'carousel';
  if (channel === 'linkedin' && !imageUrl) return 'text';
  return 'image';
}

// Campanha da tabela (sincronizada do campaigns.yaml). Ausente não bloqueia a aprovação.
async function findCampaignId(t: TenantDb, slug: string): Promise<string | null> {
  const { data, error } = await t.select('campaigns', 'id').eq('slug', slug).limit(1);
  if (error) return null;
  return (data?.[0]?.id as string) ?? null;
}

export type ApproveInput = {
  pendingId: string;
  captionId: number; // variação escolhida pra legenda
  artId: number; // arte escolhida
  noImage?: boolean; // publica só o texto (SPEC 005); o Instagram não aceita
  captionText?: string; // legenda editada (sobrescreve a sugerida)
  scheduledFor?: string; // ISO; se ausente cai no próximo slot livre (ou na fila, sem slot)
  publishNow?: boolean; // agenda para agora; a rota publica em seguida
};

export async function approvePending(t: TenantDb, input: ApproveInput): Promise<{ scheduledFor: string | null; id: string; requestedMissed: boolean }> {
  const p = await loadPending(t, input.pendingId);
  if (!p) throw new UserError('Pendência não encontrada (já resolvida?).');

  const variations: Variation[] = p.generation?.variations || [];
  const variation = variations.find((v) => v.id === input.captionId) || variations[0];
  if (!variation) throw new UserError('Variação de legenda inválida.');

  const images: ImageRef[] = p.images || [];
  if (input.noImage && p.channel === 'instagram') throw new UserError('O Instagram não publica sem imagem. Escolha uma arte.');
  const art = images.find((i) => i.id === input.artId);
  const imageUrl = input.noImage ? null : art?.url ?? images[0]?.url ?? null;

  const captionFinal = (input.captionText && input.captionText.trim()) || composeCaption(variation);

  // Horário pedido por quem mandou para Aprovar (Publicar foto, BEZ-256): vale quando quem aprova não
  // escolhe outro. Se já passou, cai no próximo horário livre e o aviso diz isso.
  const requested = requestedTime(p.seed);
  const requestedMissed = !input.publishNow && !input.scheduledFor && requested !== null && Date.parse(requested) <= Date.now();
  // Sem horário livre o post não trava: fica na fila e entra no primeiro horário criado.
  const scheduledFor = input.publishNow
    ? new Date().toISOString()
    : input.scheduledFor || (requested && !requestedMissed ? requested : null) || (await nextFreeSlot(t, p.channel));

  // O id nasce aqui pra entrar no utm_content antes do insert.
  const id = crypto.randomUUID();
  const campaignSlug = typeof p.seed?.campaign === 'string' ? p.seed.campaign : null;
  const campaignId = campaignSlug ? await findCampaignId(t, campaignSlug) : null;
  const utm = distributionUtm({ channel: p.channel, distributionId: id, campaignSlug, baseUrl: process.env.SITE_URL });

  const { data, error } = await t
    .insert('scheduled_posts', {
      id,
      channel: p.channel,
      pillar: p.generation?.pillar ?? null,
      angle: p.generation?.angle ?? null,
      variation,
      chosen_variation_id: variation.id,
      caption_final: captionFinal,
      image_url: imageUrl,
      chosen_art_id: input.noImage ? null : input.artId,
      slide_urls: variation.slideUrls?.length ? variation.slideUrls : null,
      document_url: variation.documentUrl ?? null,
      generation: p.generation,
      seed: p.seed ?? null,
      status: scheduledFor ? 'scheduled' : 'queued',
      scheduled_for: scheduledFor,
      source_pending_id: p.pending_id,
      brief_id: p.brief_id ?? null,
      // foto do banco de imagens mandada para Aprovar (BEZ-236): o publish marca a foto como usada
      media_asset_id: typeof p.seed?.media_asset_id === 'string' ? p.seed.media_asset_id : null,
      campaign_id: campaignId,
      media_kind: mediaKindOf(p.channel, variation, imageUrl, captionFinal),
      utm,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Falha ao agendar: ${error.message}`);

  // consome a pendência
  await t.delete('pending_approvals').eq('pending_id', p.pending_id);

  // Publicar agora avisa pelo resultado da publicação, não pelo agendamento.
  if (!input.publishNow) {
    await notify(t, {
      kind: 'schedule.created',
      title: scheduledFor
        ? `Agendado no ${channelName(p.channel)} para ${fmtLocal(scheduledFor)}`
        : `Aprovado para o ${channelName(p.channel)}: na fila até ter horário na agenda`,
      body: requestedMissed
        ? `O horário pedido (${fmtLocal(requested!)}) já tinha passado. ${scheduledFor ? 'Entrou no próximo horário livre.' : 'Ficou na fila.'}`
        : (variation.hook || '').slice(0, 80) || undefined,
      link: '/calendar',
    });
  }
  return { scheduledFor, id: data!.id as string, requestedMissed };
}

// O horário que quem mandou para Aprovar pediu (seed.requested_for), se for uma data válida.
export function requestedTime(seed: Record<string, unknown> | null | undefined): string | null {
  const raw = seed?.requested_for;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function rejectPending(t: TenantDb, pendingId: string, reason?: string): Promise<void> {
  const p = await loadPending(t, pendingId);
  if (!p) throw new UserError('Pendência não encontrada (já resolvida?).');
  const top = (p.generation?.variations || []).find((v) => v.id === p.top_id) || p.generation?.variations?.[0];
  await t.insert('rejected_posts', {
    pillar: p.generation?.pillar ?? null,
    angle: p.generation?.angle ?? null,
    channel: p.channel,
    hook: top?.hook ?? null,
    body: top?.body ?? null,
    format: top?.format ?? null,
    reason: reason || 'rejeitado via plataforma',
  });
  await t.delete('pending_approvals').eq('pending_id', p.pending_id);
  await notify(t, {
    kind: 'pending.rejected',
    title: `Post do ${channelName(p.channel)} rejeitado`,
    body: reason || undefined,
    link: '/learning',
  });
}

export async function reschedulePost(t: TenantDb, id: string, scheduledFor: string): Promise<void> {
  const { data, error } = await t
    .update('scheduled_posts', { scheduled_for: scheduledFor, status: 'scheduled', last_error: null })
    .eq('id', id)
    .in('status', ['scheduled', 'queued', 'failed'])
    .select('id');
  if (error) throw new Error(`Falha ao reagendar: ${error.message}`);
  if (!data?.length) throw new UserError(NOT_FOUND);
}

export async function cancelScheduled(t: TenantDb, id: string): Promise<void> {
  const { data, error } = await t.delete('scheduled_posts').eq('id', id).in('status', ['scheduled', 'queued', 'failed']).select('id');
  if (error) throw new Error(`Falha ao cancelar: ${error.message}`);
  if (!data?.length) throw new UserError(NOT_FOUND);
}

export async function retryScheduled(t: TenantDb, id: string): Promise<void> {
  const { data, error } = await t
    .update('scheduled_posts', { status: 'scheduled', last_error: null })
    .eq('id', id)
    .eq('status', 'failed')
    .select('id');
  if (error) throw new Error(`Falha ao re-tentar: ${error.message}`);
  if (!data?.length) throw new UserError(NOT_FOUND);
}

// Horário novo na agenda: os aprovados que esperavam na fila entram nos horários livres, na ordem
// em que foram aprovados. Devolve quantos ganharam horário.
export async function scheduleQueued(t: TenantDb, channel: Channel): Promise<number> {
  const { data, error } = await t
    .select('scheduled_posts', 'id')
    .eq('channel', channel)
    .eq('status', 'queued')
    .order('approved_at', { ascending: true });
  if (error) throw new Error(`Falha ao ler a fila: ${error.message}`);
  let scheduled = 0;
  for (const row of data || []) {
    const when = await nextFreeSlot(t, channel);
    if (!when) break;
    const { error: ue } = await t
      .update('scheduled_posts', { status: 'scheduled', scheduled_for: when })
      .eq('id', row.id as string)
      .eq('status', 'queued');
    if (ue) throw new Error(`Falha ao agendar a fila: ${ue.message}`);
    scheduled += 1;
  }
  return scheduled;
}

export { fmtLocal };
