// campaigns.ts: ler e gravar as campanhas de uma conta (SPEC 018, BEZ-262). Tudo pelo tenantDb: o tenant vem da
// sessão. Quem lê (content.view) e quem escreve (brand.manage) é decidido na rota e na RLS. A auditoria registra
// a ação, nunca o texto. Só a campanha ativa, confirmada e dentro do prazo influencia o coordenador.

import { randomBytes } from 'node:crypto';
import { db } from './db';
import { log } from './log';
import { notify } from './notifications';
import { tenantDb, type TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { ConflictError, NotFoundError, UserError } from './errors';
import { auditTenant } from './audit';
import { latestPostMetrics } from './instagram-metrics';
import {
  campaignFromRow,
  campaignSlug,
  compareEngagement,
  dayCount,
  todayLocal,
  transition,
  weekBounds,
  type Campaign,
  type CampaignAction,
  type CampaignInput,
  type CampaignPatch,
  type CampaignProgress,
  type MetricSample,
} from './campaign-model';

const COLUMNS =
  'id,slug,name,kind,objective,offering,audience,cta,restrictions,target_label,target_value,posts_per_week,start_date,end_date,status,confirmed_at,confirmed_by,created_at';
const NOT_FOUND = 'Campanha não encontrada. Recarregue a página.';
const ENGAGEMENT_DAYS = 90;
const MAX_CAMPAIGNS = 200;

export async function listCampaigns(t: TenantDb): Promise<Campaign[]> {
  const { data, error } = await t.select('campaigns', COLUMNS).order('created_at', { ascending: false }).limit(MAX_CAMPAIGNS);
  if (error) throw new Error(`campanhas: ${error.message}`);
  const all = (data ?? []).map(campaignFromRow);
  // A ativa no topo; depois pausada e rascunho; encerradas e arquivadas por último.
  const rank: Record<string, number> = { active: 0, paused: 1, draft: 2, ended: 3, archived: 4 };
  return all.sort((a, b) => rank[a.status] - rank[b.status]);
}

export async function getCampaign(t: TenantDb, id: string): Promise<Campaign> {
  const { data, error } = await t.select('campaigns', COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`campanhas: ${error.message}`);
  if (!data) throw new NotFoundError(NOT_FOUND);
  return campaignFromRow(data);
}

// A campanha que o coordenador usa hoje: ativa, confirmada e dentro do prazo (no máximo uma por conta).
export async function activeCampaign(t: TenantDb, today: string = todayLocal()): Promise<Campaign | null> {
  const { data, error } = await t
    .select('campaigns', COLUMNS)
    .eq('status', 'active')
    .not('confirmed_at', 'is', null)
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .limit(1);
  if (error) throw new Error(`campanhas: ${error.message}`);
  return data?.[0] ? campaignFromRow(data[0]) : null;
}

async function countAll(t: TenantDb): Promise<number> {
  const res = await t.select('campaigns', 'id', { count: 'exact', head: true });
  if (res.error) throw new Error(`campanhas: ${res.error.message}`);
  return res.count ?? 0;
}

// Nasce rascunho: não muda nenhuma sugestão até uma pessoa confirmar.
export async function createCampaign(t: TenantDb, actor: SessionUser, input: CampaignInput): Promise<Campaign> {
  if ((await countAll(t)) >= MAX_CAMPAIGNS) throw new UserError(`A conta já tem ${MAX_CAMPAIGNS} campanhas. Arquive as antigas antes de criar outra.`);
  const { name, kind, objective, offering, audience, cta, restrictions, target_label, target_value, posts_per_week, start_date, end_date } = input;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = campaignSlug(name, attempt === 0 ? '' : randomBytes(2).toString('hex'));
    const { data, error } = await t
      .insert('campaigns', { slug, name, kind, objective, offering, audience, cta, restrictions, target_label, target_value, posts_per_week, start_date, end_date, status: 'draft', created_by: actor.id })
      .select(COLUMNS)
      .single();
    // O mesmo nome já gerou este slug nesta conta (único por conta): tenta de novo com um sufixo.
    if (error?.code === '23505') continue;
    if (error) throw new Error(`campanhas: ${error.message}`);
    await auditTenant(t, { actorUserId: actor.id, action: 'campaign.created', targetType: 'campaign', targetId: String(data!.id), metadata: { kind } });
    return campaignFromRow(data!);
  }
  throw new Error('campanhas: não achou slug livre');
}

export async function updateCampaign(t: TenantDb, actor: SessionUser, id: string, patch: CampaignPatch): Promise<Campaign> {
  const current = await getCampaign(t, id);
  if (current.status === 'ended' || current.status === 'archived') throw new ConflictError('Campanha encerrada não muda. Duplique para criar outra a partir dela.');
  const { data, error } = await t.update('campaigns', patch).eq('id', id).in('status', ['draft', 'active', 'paused']).select(COLUMNS).maybeSingle();
  if (error) throw new Error(`campanhas: ${error.message}`);
  if (!data) throw new ConflictError('A campanha mudou de estado. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'campaign.updated', targetType: 'campaign', targetId: id, metadata: { fields: Object.keys(patch) } });
  return campaignFromRow(data);
}

const AUDIT: Record<CampaignAction, string> = { confirm: 'campaign.confirmed', pause: 'campaign.paused', resume: 'campaign.resumed', end: 'campaign.ended', archive: 'campaign.archived' };

// Confirmar e retomar viram ativa: só uma por conta. O índice único parcial é a trava de verdade; a leitura
// antes só dá a mensagem certa.
async function assertNoOtherActive(t: TenantDb, id: string): Promise<void> {
  const other = await t.select('campaigns', 'id,name').eq('status', 'active').neq('id', id).limit(1);
  if (other.error) throw new Error(`campanhas: ${other.error.message}`);
  if (other.data?.length) throw new ConflictError(`Já existe uma campanha ativa: ${String(other.data[0].name)}. A conta tem uma por vez. Pause ou encerre essa antes.`);
}

export async function changeCampaign(t: TenantDb, actor: SessionUser, id: string, action: CampaignAction, now: Date = new Date()): Promise<Campaign> {
  const current = await getCampaign(t, id);
  const to = transition(current.status, action);
  if (!to) throw new ConflictError('Esta campanha não pode mudar assim agora. Recarregue a página.');
  const values: Record<string, unknown> = { status: to };
  if (to === 'active') {
    const today = todayLocal(now);
    if (!current.endDate || current.endDate < today) throw new UserError('O prazo da campanha já passou. Escolha uma data final de hoje em diante e confirme de novo.');
    await assertNoOtherActive(t, id);
  }
  if (action === 'confirm') Object.assign(values, { confirmed_by: actor.id, confirmed_at: now.toISOString() });
  // Muda só se ainda estiver no estado lido: dois cliques ao mesmo tempo, um passa.
  const res = await t.update('campaigns', values).eq('id', id).eq('status', current.status).select(COLUMNS).maybeSingle();
  if (res.error?.code === '23505') throw new ConflictError('Já existe uma campanha ativa. A conta tem uma por vez. Pause ou encerre essa antes.');
  if (res.error) throw new Error(`campanhas: ${res.error.message}`);
  if (!res.data) throw new ConflictError('A campanha mudou de estado. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: AUDIT[action], targetType: 'campaign', targetId: id, metadata: { from: current.status, to } });
  return campaignFromRow(res.data);
}

// Posts da campanha: o pedido (briefs.campaign_id) liga ao agendado, que liga ao post publicado.
export async function campaignProgress(t: TenantDb, id: string, now: Date = new Date()): Promise<CampaignProgress> {
  const campaign = await getCampaign(t, id);
  const today = todayLocal(now);
  const week = weekBounds(today);

  const sugg = await t.select('content_suggestions', 'status').eq('campaign_id', id);
  if (sugg.error) throw new Error(`campanhas: ${sugg.error.message}`);
  const suggested = (sugg.data ?? []).filter((s) => s.status === 'suggested').length;
  const created = (sugg.data ?? []).filter((s) => s.status === 'created').length;

  const briefs = await t.select('briefs', 'id').eq('campaign_id', id);
  if (briefs.error) throw new Error(`campanhas: ${briefs.error.message}`);
  const briefIds = (briefs.data ?? []).map((b) => String(b.id));
  const sched = briefIds.length
    ? await t.select('scheduled_posts', 'id,status,scheduled_for,published_at').in('brief_id', briefIds).in('status', ['scheduled', 'publishing', 'published'])
    : { data: [] as Record<string, unknown>[], error: null };
  if (sched.error) throw new Error(`campanhas: ${sched.error.message}`);
  const rows = sched.data ?? [];
  const scheduled = rows.filter((r) => r.status !== 'published').length;
  const publishedRows = rows.filter((r) => r.status === 'published');
  const inWeek = rows.filter((r) => {
    const day = todayLocal(new Date(String((r.published_at as string | null) ?? r.scheduled_for)));
    return day >= week.start && day < week.end;
  }).length;

  const profile = await t.select('company_profiles', 'posts_per_week').maybeSingle();
  const target = campaign.postsPerWeek ?? (typeof profile.data?.posts_per_week === 'number' ? (profile.data.posts_per_week as number) : null);

  return {
    daysLeft: campaign.endDate ? Math.max(dayCount(today, campaign.endDate), 0) : null,
    daysTotal: campaign.startDate && campaign.endDate ? dayCount(campaign.startDate, campaign.endDate) : null,
    suggested,
    created,
    scheduled,
    published: publishedRows.length,
    cadence: { thisWeek: inWeek, target },
    engagement: await engagementOf(t, publishedRows.map((r) => String(r.id)), now),
  };
}

// Engajamento dos posts da campanha contra a média da conta nos últimos 90 dias. Falha de leitura não derruba o
// progresso: fica sem número.
async function engagementOf(t: TenantDb, campaignScheduledIds: string[], now: Date) {
  const empty = compareEngagement([], []);
  try {
    const since = new Date(now.getTime() - ENGAGEMENT_DAYS * 86_400_000).toISOString();
    const posts = await t.select('posts', 'id,scheduled_post_id').eq('channel', 'instagram').eq('is_dry_run', false).gte('published_at', since).limit(500);
    if (posts.error) throw new Error(posts.error.message);
    const list = posts.data ?? [];
    if (!list.length) return empty;
    const metrics = await latestPostMetrics(t, list.map((p) => String(p.id)));
    const sample = (id: string): MetricSample | null => {
      const m = metrics[id];
      return m ? { likes: m.likes, comments: m.comments, rate: m.engagement } : null;
    };
    const mine = new Set(campaignScheduledIds);
    const campaign = list.filter((p) => mine.has(String(p.scheduled_post_id))).map((p) => sample(String(p.id)));
    const account = list.map((p) => sample(String(p.id)));
    return compareEngagement(campaign.filter((s): s is MetricSample => !!s), account.filter((s): s is MetricSample => !!s));
  } catch {
    return empty;
  }
}

export type EndedSummary = { ended: number; failed: number };

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

// O texto do aviso de encerramento: posts, cadência e engajamento. Nunca venda.
export function endedNoticeBody(p: CampaignProgress): string {
  const posts = p.published === 1 ? '1 post publicado' : `${p.published} posts publicados`;
  const e = p.engagement;
  if (e.campaign === null) return `${posts}. O coordenador voltou à rotação.`;
  const value = (v: number | null) => (v === null ? null : e.unit === 'rate' ? pct(v) : `${Math.round(v)} curtidas e comentários por post`);
  const mine = value(e.campaign);
  const account = value(e.account);
  return `${posts}, com engajamento de ${mine}${account ? ` (média da conta: ${account})` : ''}. O coordenador voltou à rotação.`;
}

// Job diário: campanha ativa ou pausada cujo prazo passou vira encerrada, e o administrador recebe o resumo.
// Uma conta que falha não para as outras.
export async function endExpiredCampaigns(now: Date = new Date()): Promise<EndedSummary> {
  const today = todayLocal(now);
  // sistema: leitura entre tenants, só o que passou do prazo
  const { data, error } = await db().from('campaigns').select('id,tenant_id,name').in('status', ['active', 'paused']).lt('end_date', today).limit(2000);
  if (error) throw new Error(`campanhas vencidas: ${error.message}`);
  const summary: EndedSummary = { ended: 0, failed: 0 };
  for (const row of data ?? []) {
    const t = tenantDb(String(row.tenant_id));
    try {
      const res = await t.update('campaigns', { status: 'ended' }).eq('id', String(row.id)).in('status', ['active', 'paused']).select('id').maybeSingle();
      if (res.error) throw new Error(res.error.message);
      if (!res.data) continue; // outra rodada encerrou primeiro
      await auditTenant(t, { actorUserId: null, actorKind: 'system', action: 'campaign.ended', targetType: 'campaign', targetId: String(row.id), metadata: { from: 'expired', to: 'ended' } });
      const progress = await campaignProgress(t, String(row.id), now);
      await notify(t, { kind: 'campaign.ended', title: `Campanha encerrada: ${String(row.name).slice(0, 80)}`, body: endedNoticeBody(progress), link: '/campaigns', audience: 'admin' });
      summary.ended += 1;
    } catch (e) {
      summary.failed += 1;
      log('error', 'campaigns', 'não encerrou a campanha vencida', { tenant: String(row.tenant_id), error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
