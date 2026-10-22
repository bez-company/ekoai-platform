// content-coordinator.ts: o coordenador de conteúdo (SPEC 017 decisão 8, BEZ-239), lado I/O. O job
// diário (/api/cron/plan-content) passa por cada conta com horários de Instagram, lê o que já saiu e
// o que está agendado, os horários livres dos próximos 7 dias e as fotos do banco, e grava uma
// sugestão por horário livre (as regras estão em content-plan-model.ts). A ideia de cada sugestão
// sai de uma chamada ao modelo de texto por rodada; se falhar, sai do próprio objetivo.
//
// Com métricas de ao menos 2 objetivos (BEZ-246), o engajamento pesa junto da sequência.
//
// A pessoa decide cada sugestão: Criar este post (vira pedido de post, que gasta o limite do plano
// só quando gerar o visual), Trocar (outra sugestão para o mesmo horário) ou Pular. Piloto automático
// (gerar sozinho) fica fora até medir a taxa de aprovação (decisão do Matheus pendente na SPEC).

import { db } from './db';
import { tenantDb, type TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { log } from './log';
import { notify } from './notifications';
import { getPauseState } from './pause';
import { getActiveSlots, tzOffsetHours, upcomingSlotEpochs } from './slots';
import { createPostRequest, wakeWorker } from './post-requests';
import { DEFAULT_RATIO, GOALS, isPostGoal, kindForGoal, type PostGoal } from './generation-model';
import { listMediaAssets } from './media-assets';
import { isSuggestable } from './media-asset-model';
import { vertexClient, type ModelClient } from './vertex';
import { latestPostMetrics } from './instagram-metrics';
import {
  METRICS_DAYS,
  PLAN_DAYS,
  commemorativeDates,
  engagementByGoal,
  fallbackIdea,
  ideasPrompt,
  parseIdeas,
  planSuggestions,
  type MetricSample,
  type PlanHistoryItem,
  type PlannedSuggestion,
} from './content-plan-model';

const DAY = 86_400_000;
const HISTORY_DAYS = 30;
const COLUMNS = 'id,channel,slot_at,goal,asset_id,date_key,idea,reason,status,brief_id,created_at';

export type Suggestion = {
  id: string;
  slotAt: string;
  goal: PostGoal;
  goalLabel: string;
  assetId: string | null;
  idea: string;
  reason: string;
  status: 'suggested' | 'created' | 'skipped' | 'replaced';
  briefId: string | null;
};

export type CoordinatorDeps = { models?: ModelClient | null; now?: Date };

function toSuggestion(r: Record<string, unknown>): Suggestion {
  const goal = r.goal as PostGoal;
  return {
    id: String(r.id),
    slotAt: new Date(r.slot_at as string).toISOString(),
    goal,
    goalLabel: GOALS[goal]?.label ?? goal,
    assetId: (r.asset_id as string | null) ?? null,
    idea: String(r.idea),
    reason: String(r.reason),
    status: r.status as Suggestion['status'],
    briefId: (r.brief_id as string | null) ?? null,
  };
}

// Sugestões abertas dos próximos dias, em ordem de horário (Início e Agenda).
export async function listSuggestions(t: TenantDb, now = new Date()): Promise<Suggestion[]> {
  const res = await t.select('content_suggestions', COLUMNS).eq('status', 'suggested').gt('slot_at', now.toISOString()).order('slot_at', { ascending: true }).limit(50);
  if (res.error) throw new Error(`sugestões: ${res.error.message}`);
  return (res.data ?? []).map(toSuggestion);
}

type Context = {
  freeSlots: string[];
  history: PlanHistoryItem[];
  avoid: Record<string, PostGoal[]>;
  usedDateKeys: string[];
  openAssetIds: Set<string>;
};

async function loadContext(t: TenantDb, now: Date): Promise<Context | null> {
  const slots = await getActiveSlots(t, 'instagram');
  if (!slots.length) return null;
  const nowMs = now.getTime();
  const fromIso = new Date(nowMs - HISTORY_DAYS * DAY).toISOString();

  const sched = await t
    .select('scheduled_posts', 'scheduled_for,published_at,status,brief_id,media_asset_id')
    .eq('channel', 'instagram')
    .in('status', ['scheduled', 'publishing', 'published'])
    .gte('scheduled_for', fromIso);
  if (sched.error) throw new Error(`agendados: ${sched.error.message}`);
  const sugg = await t.select('content_suggestions', 'slot_at,goal,asset_id,date_key,status').gte('slot_at', fromIso);
  if (sugg.error) throw new Error(`sugestões: ${sugg.error.message}`);

  const briefIds = [...new Set((sched.data ?? []).map((r) => r.brief_id as string | null).filter((id): id is string => !!id))];
  const goals = new Map<string, PostGoal | null>();
  if (briefIds.length) {
    const briefs = await t.select('briefs', 'id,goal').in('id', briefIds);
    if (briefs.error) throw new Error(`pedidos: ${briefs.error.message}`);
    for (const b of briefs.data ?? []) goals.set(String(b.id), isPostGoal(b.goal) ? b.goal : null);
  }

  const occupied = new Set<number>();
  const history: PlanHistoryItem[] = [];
  for (const r of sched.data ?? []) {
    const at = (r.published_at as string | null) ?? (r.scheduled_for as string);
    if (r.status !== 'published') occupied.add(new Date(r.scheduled_for as string).getTime());
    history.push({ at, goal: r.brief_id ? goals.get(String(r.brief_id)) ?? null : null, withPhoto: !!r.media_asset_id });
  }

  const avoid: Record<string, PostGoal[]> = {};
  const usedDateKeys: string[] = [];
  const openAssetIds = new Set<string>();
  for (const s of sugg.data ?? []) {
    const slotIso = new Date(s.slot_at as string).toISOString();
    const goal = s.goal as PostGoal;
    if (s.date_key && s.status !== 'replaced') usedDateKeys.push(String(s.date_key));
    if (s.status === 'replaced' || s.status === 'skipped') (avoid[slotIso] ??= []).push(goal);
    if (s.status === 'skipped') occupied.add(new Date(slotIso).getTime());
    if (s.status === 'suggested' || s.status === 'created') {
      occupied.add(new Date(slotIso).getTime());
      history.push({ at: slotIso, goal, withPhoto: !!s.asset_id });
      if (s.asset_id) openAssetIds.add(String(s.asset_id));
    }
  }

  const freeSlots = upcomingSlotEpochs(slots, nowMs, PLAN_DAYS)
    .filter((ms) => !occupied.has(ms))
    .map((ms) => new Date(ms).toISOString());
  return { freeSlots, history, avoid, usedDateKeys, openAssetIds };
}

// Engajamento por objetivo dos posts publicados nos últimos 90 dias: o post (métricas) liga ao agendado,
// que liga ao pedido (objetivo). Falha de leitura não derruba o planejamento: fica sem métrica.
async function goalEngagement(t: TenantDb, now: Date): Promise<Partial<Record<PostGoal, number>>> {
  try {
    const since = new Date(now.getTime() - METRICS_DAYS * DAY).toISOString();
    const posts = await t.select('posts', 'id,scheduled_post_id,published_at').eq('channel', 'instagram').eq('is_dry_run', false).gte('published_at', since).limit(300);
    if (posts.error) throw new Error(posts.error.message);
    const rows = (posts.data ?? []).filter((p) => p.scheduled_post_id);
    if (!rows.length) return {};
    const sched = await t.select('scheduled_posts', 'id,brief_id').in('id', rows.map((p) => String(p.scheduled_post_id)));
    if (sched.error) throw new Error(sched.error.message);
    const briefOf = new Map((sched.data ?? []).filter((r) => r.brief_id).map((r) => [String(r.id), String(r.brief_id)]));
    const briefIds = [...new Set(briefOf.values())];
    const goals = new Map<string, PostGoal | null>();
    if (briefIds.length) {
      const briefs = await t.select('briefs', 'id,goal').in('id', briefIds);
      if (briefs.error) throw new Error(briefs.error.message);
      for (const b of briefs.data ?? []) goals.set(String(b.id), isPostGoal(b.goal) ? b.goal : null);
    }
    const metrics = await latestPostMetrics(t, rows.map((p) => String(p.id)));
    const samples: MetricSample[] = rows.flatMap((p) => {
      const m = metrics[String(p.id)];
      const brief = briefOf.get(String(p.scheduled_post_id));
      if (!m || !brief) return [];
      return [{ goal: goals.get(brief) ?? null, publishedAt: new Date(p.published_at as string).toISOString(), likes: m.likes, comments: m.comments, rate: m.engagement }];
    });
    return engagementByGoal(samples, now);
  } catch (e) {
    log('warn', 'content-coordinator', 'não leu as métricas; segue só com a regra de sequência', { tenant: t.tenantId, error: e instanceof Error ? e.message : String(e) });
    return {};
  }
}

async function profileOf(t: TenantDb): Promise<{ niche: string | null; offering: string | null }> {
  const res = await t.select('company_profiles', 'niche,offering').maybeSingle();
  if (res.error || !res.data) return { niche: null, offering: null };
  return { niche: (res.data.niche as string | null) ?? null, offering: (res.data.offering as string | null) ?? null };
}

async function writeIdeas(
  t: TenantDb,
  planned: PlannedSuggestion[],
  photoText: Map<string, string | null>,
  dateName: Map<string, string>,
  models: ModelClient | null,
): Promise<string[]> {
  const items = planned.map((p, i) => ({ i, goal: p.goal, photo: p.assetId ? photoText.get(p.assetId) ?? null : null, date: p.dateKey ? dateName.get(p.dateKey) ?? null : null }));
  let ideas: (string | null)[] = items.map(() => null);
  if (models && items.length) {
    try {
      const out = await models.generateJson({ prompt: ideasPrompt({ ...(await profileOf(t)), items }), labels: { tenant: t.tenantId, step: 'content_plan' }, maxOutputTokens: 1200, temperature: 0.8 });
      ideas = parseIdeas(out.json, items.length);
      log('info', 'content-coordinator', 'ideias escritas', { tenant: t.tenantId, count: items.length, costUsd: out.costUsd });
    } catch (e) {
      log('warn', 'content-coordinator', 'não escreveu as ideias; usa o objetivo', { tenant: t.tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return items.map((it, i) => ideas[i] ?? fallbackIdea(it.goal, it.photo, it.date));
}

// Planeja e grava as sugestões que faltam. `onlySlot` = replanejar um horário só (Trocar).
export async function planForTenant(t: TenantDb, deps: CoordinatorDeps = {}, onlySlot?: string): Promise<Suggestion[]> {
  const now = deps.now ?? new Date();
  const ctx = await loadContext(t, now);
  if (!ctx) return [];
  const slots = onlySlot ? [onlySlot] : ctx.freeSlots;
  if (!slots.length) return [];

  const assets = await listMediaAssets(t, { filter: 'all', tag: null, limit: 500 });
  const photos = assets.filter((a) => isSuggestable(a, now) && !ctx.openAssetIds.has(a.id)).map((a) => ({ id: a.id, description: a.description, tags: a.tags }));
  const year = Number(new Date(now.getTime() + tzOffsetHours() * 3_600_000).toISOString().slice(0, 4));
  const dates = [...commemorativeDates(year), ...commemorativeDates(year + 1)];

  const planned = planSuggestions({
    now,
    slots,
    history: ctx.history,
    photos,
    dates,
    // Métricas do Instagram por objetivo (BEZ-246); com amostra pequena vem vazio e vale só a sequência.
    engagement: await goalEngagement(t, now),
    avoid: ctx.avoid,
    usedDateKeys: ctx.usedDateKeys,
    tzOffsetHours: tzOffsetHours(),
  });
  if (!planned.length) return [];

  const models = deps.models === undefined ? vertexClient() : deps.models;
  const ideas = await writeIdeas(t, planned, new Map(photos.map((p) => [p.id, p.description])), new Map(dates.map((d) => [d.key, d.name])), models);

  const saved: Suggestion[] = [];
  for (const [i, p] of planned.entries()) {
    const res = await t
      .insert('content_suggestions', { channel: 'instagram', slot_at: p.slotAt, goal: p.goal, asset_id: p.assetId, date_key: p.dateKey, idea: ideas[i], reason: p.reason })
      .select(COLUMNS)
      .single();
    // Outra rodada gravou este horário primeiro (índice único da sugestão aberta): segue.
    if (res.error?.code === '23505') continue;
    if (res.error) throw new Error(`sugestões: ${res.error.message}`);
    saved.push(toSuggestion(res.data!));
  }
  return saved;
}

async function openSuggestion(t: TenantDb, id: string): Promise<Suggestion> {
  const res = await t.select('content_suggestions', COLUMNS).eq('id', id).maybeSingle();
  if (res.error) throw new Error(`sugestões: ${res.error.message}`);
  if (!res.data || res.data.status !== 'suggested') throw new UserError('Esta sugestão já foi usada, trocada ou pulada. Recarregue a página.');
  return toSuggestion(res.data);
}

// Muda o estado só se ainda estiver aberta (dois cliques ao mesmo tempo: um passa).
async function decide(t: TenantDb, actor: SessionUser | null, id: string, values: Record<string, unknown>): Promise<void> {
  const res = await t
    .update('content_suggestions', { ...values, decided_by: actor?.id ?? null, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'suggested')
    .select('id')
    .maybeSingle();
  if (res.error) throw new Error(`sugestões: ${res.error.message}`);
  if (!res.data) throw new UserError('Esta sugestão já foi usada, trocada ou pulada. Recarregue a página.');
}

export async function skipSuggestion(t: TenantDb, actor: SessionUser | null, id: string): Promise<void> {
  await openSuggestion(t, id);
  await decide(t, actor, id, { status: 'skipped' });
}

// Trocar: a atual sai e entra outra para o mesmo horário, sem o objetivo trocado.
export async function replaceSuggestion(t: TenantDb, actor: SessionUser | null, id: string, deps: CoordinatorDeps = {}): Promise<Suggestion | null> {
  const current = await openSuggestion(t, id);
  await decide(t, actor, id, { status: 'replaced' });
  const [next] = await planForTenant(t, deps, current.slotAt);
  return next ?? null;
}

// Criar este post. Sugestão com foto do banco não gera imagem: a tela abre o "Publicar foto"
// (BEZ-236) com a foto e a ideia. Sem foto, vira pedido de post com o objetivo.
export async function createFromSuggestion(
  t: TenantDb,
  actor: SessionUser | null,
  id: string,
  options: { wake?: () => void } = {},
): Promise<{ kind: 'photo'; assetId: string; idea: string } | { kind: 'generate'; briefId: string }> {
  const s = await openSuggestion(t, id);
  if (s.assetId) {
    await decide(t, actor, id, { status: 'created' });
    return { kind: 'photo', assetId: s.assetId, idea: s.idea };
  }
  const { id: briefId } = await createPostRequest(t, actor, { idea: s.idea, goal: s.goal, kind: kindForGoal(s.goal), ratio: DEFAULT_RATIO });
  await decide(t, actor, id, { status: 'created', brief_id: briefId });
  (options.wake ?? wakeWorker)();
  return { kind: 'generate', briefId };
}

export type PlanningSummary = { accounts: number; suggested: number; paused: number; failed: number };

// Job de sistema: todas as contas com horário de Instagram. Uma conta que falha não para as outras.
export async function runContentPlanning(deps: CoordinatorDeps = {}): Promise<PlanningSummary> {
  // sistema: leitura entre tenants, só o dono dos horários
  const { data, error } = await db().from('publish_slots').select('tenant_id').eq('active', true).eq('channel', 'instagram').limit(5000);
  if (error) throw new Error(`horários: ${error.message}`);
  const now = deps.now ?? new Date();
  const monday = new Date(now.getTime() + tzOffsetHours() * 3_600_000).getUTCDay() === 1;
  const summary: PlanningSummary = { accounts: 0, suggested: 0, paused: 0, failed: 0 };
  for (const tenantId of new Set((data ?? []).map((r) => String(r.tenant_id)))) {
    const t = tenantDb(tenantId);
    if ((await getPauseState(t)).paused) {
      summary.paused += 1;
      continue;
    }
    summary.accounts += 1;
    try {
      const saved = await planForTenant(t, { ...deps, now });
      summary.suggested += saved.length;
      // Aviso semanal: na segunda, com o total de sugestões abertas da semana (não só as desta rodada).
      const open = monday && saved.length ? (await listSuggestions(t, now)).length : 0;
      if (open) {
        await notify(t, {
          kind: 'suggestions.week',
          title: 'Sugestões da semana prontas',
          body: `${open === 1 ? '1 post sugerido' : `${open} posts sugeridos`} para os próximos 7 dias, cada um com o motivo. Crie, troque ou pule.`,
          link: '/',
          audience: 'team',
        });
      }
    } catch (e) {
      summary.failed += 1;
      log('error', 'content-coordinator', 'não planejou a conta', { tenant: tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
