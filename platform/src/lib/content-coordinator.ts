// content-coordinator.ts: o coordenador de conteúdo (SPEC 017 decisão 8, BEZ-239), lado I/O. O job
// diário (/api/cron/plan-content) passa por cada conta com horários de Instagram, lê o que já saiu e
// o que está agendado, os horários livres dos próximos 7 dias e as fotos do banco, e grava uma
// sugestão por horário livre (as regras estão em content-plan-model.ts). A ideia de cada sugestão
// sai de uma chamada ao modelo de texto por rodada; se falhar, sai do próprio objetivo.
//
// Com métricas de ao menos 2 objetivos (BEZ-246), o engajamento pesa junto da sequência.
//
// Campanha (SPEC 018): a campanha ativa, confirmada e dentro do prazo ocupa parte dos horários da semana
// (content-plan-model.ts); a ideia de cada sugestão leva o que a campanha diz e só os fatos confirmados e
// vigentes. Custo com teto: no máximo MAX_LLM_CALLS_PER_DAY chamadas de texto por conta e dia (a rodada
// diária e os "Trocar") e, no job, PLAN_BUDGET_USD_PER_RUN no total; acima disso a ideia sai do próprio
// objetivo (fallbackIdea). A rodada diária é reivindicada em `planning_runs` (round_at): o job rodado duas
// vezes no dia, ou dois ao mesmo tempo, planeja e gasta uma vez só.
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
import { listFacts } from './company-facts';
import { factsForPrompt, todayLocal } from './company-facts-model';
import { activeCampaign } from './campaigns';
import { KIND_GOALS, campaignSlotQuota, type Campaign } from './campaign-model';
import {
  METRICS_DAYS,
  PLAN_DAYS,
  commemorativeDates,
  engagementByGoal,
  fallbackIdea,
  ideaProblems,
  ideasPrompt,
  parseIdeas,
  planSuggestions,
  type IdeaCampaign,
  type MetricSample,
  type PlanCampaign,
  type PlanHistoryItem,
  type PlanRule,
  type PlannedSuggestion,
} from './content-plan-model';

const DAY = 86_400_000;
const HISTORY_DAYS = 30;
const COLUMNS = 'id,channel,slot_at,goal,asset_id,date_key,idea,reason,status,brief_id,created_at,campaign_id,rule';

// Teto de chamadas de texto por conta e dia: a rodada diária e os "Trocar" juntos. Acima, só fallbackIdea.
export const MAX_LLM_CALLS_PER_DAY = 10;

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
  campaignId: string | null;
  rule: PlanRule | null;
};

// `budget` é o que sobra, em dólares, do teto da rodada do job: acima de zero ainda chama o modelo.
export type CoordinatorDeps = { models?: ModelClient | null; now?: Date; budget?: { remainingUsd: () => number } };

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
    campaignId: (r.campaign_id as string | null) ?? null,
    rule: (['date', 'photo', 'rotation', 'campaign'] as const).find((x) => x === r.rule) ?? null,
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
  // Horários de campanha que a semana já tem (sugestão aberta ou criada, e pedido agendado) e o total de horários
  // da semana: daqui sai quantos ainda cabem na campanha.
  campaignMs: Set<number>;
  totalSlots: number;
};

async function loadContext(t: TenantDb, now: Date, campaignId: string | null): Promise<Context | null> {
  const slots = await getActiveSlots(t, 'instagram');
  if (!slots.length) return null;
  const nowMs = now.getTime();
  const horizonMs = nowMs + PLAN_DAYS * DAY;
  const fromIso = new Date(nowMs - HISTORY_DAYS * DAY).toISOString();

  const sched = await t
    .select('scheduled_posts', 'scheduled_for,published_at,status,brief_id,media_asset_id')
    .eq('channel', 'instagram')
    .in('status', ['scheduled', 'publishing', 'published'])
    .gte('scheduled_for', fromIso);
  if (sched.error) throw new Error(`agendados: ${sched.error.message}`);
  const sugg = await t.select('content_suggestions', 'slot_at,goal,asset_id,date_key,status,campaign_id').gte('slot_at', fromIso);
  if (sugg.error) throw new Error(`sugestões: ${sugg.error.message}`);

  const briefIds = [...new Set((sched.data ?? []).map((r) => r.brief_id as string | null).filter((id): id is string => !!id))];
  const goals = new Map<string, PostGoal | null>();
  const briefCampaign = new Map<string, string | null>();
  if (briefIds.length) {
    const briefs = await t.select('briefs', 'id,goal,campaign_id').in('id', briefIds);
    if (briefs.error) throw new Error(`pedidos: ${briefs.error.message}`);
    for (const b of briefs.data ?? []) {
      goals.set(String(b.id), isPostGoal(b.goal) ? b.goal : null);
      briefCampaign.set(String(b.id), (b.campaign_id as string | null) ?? null);
    }
  }

  const occupied = new Set<number>();
  const campaignMs = new Set<number>();
  const history: PlanHistoryItem[] = [];
  for (const r of sched.data ?? []) {
    const at = (r.published_at as string | null) ?? (r.scheduled_for as string);
    const forMs = new Date(r.scheduled_for as string).getTime();
    if (r.status !== 'published') occupied.add(forMs);
    if (campaignId && r.status !== 'published' && r.brief_id && briefCampaign.get(String(r.brief_id)) === campaignId && forMs > nowMs && forMs <= horizonMs) campaignMs.add(forMs);
    history.push({ at, goal: r.brief_id ? goals.get(String(r.brief_id)) ?? null : null, withPhoto: !!r.media_asset_id });
  }

  const avoid: Record<string, PostGoal[]> = {};
  const usedDateKeys: string[] = [];
  const openAssetIds = new Set<string>();
  for (const s of sugg.data ?? []) {
    const slotIso = new Date(s.slot_at as string).toISOString();
    const slotMs = new Date(slotIso).getTime();
    const goal = s.goal as PostGoal;
    if (s.date_key && s.status !== 'replaced') usedDateKeys.push(String(s.date_key));
    if (s.status === 'replaced' || s.status === 'skipped') (avoid[slotIso] ??= []).push(goal);
    if (s.status === 'skipped') occupied.add(slotMs);
    if (s.status === 'suggested' || s.status === 'created') {
      occupied.add(slotMs);
      history.push({ at: slotIso, goal, withPhoto: !!s.asset_id });
      if (s.asset_id) openAssetIds.add(String(s.asset_id));
      if (campaignId && s.campaign_id === campaignId && slotMs > nowMs && slotMs <= horizonMs) campaignMs.add(slotMs);
    }
  }

  const horizon = upcomingSlotEpochs(slots, nowMs, PLAN_DAYS);
  const freeSlots = horizon.filter((ms) => !occupied.has(ms)).map((ms) => new Date(ms).toISOString());
  return { freeSlots, history, avoid, usedDateKeys, openAssetIds, campaignMs, totalSlots: horizon.length };
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

type ProfileView = { niche: string | null; offering: string | null; bannedWords: string[] };

async function profileOf(t: TenantDb): Promise<ProfileView> {
  const res = await t.select('company_profiles', 'niche,offering,banned_words').maybeSingle();
  if (res.error || !res.data) return { niche: null, offering: null, bannedWords: [] };
  return {
    niche: (res.data.niche as string | null) ?? null,
    offering: (res.data.offering as string | null) ?? null,
    bannedWords: Array.isArray(res.data.banned_words) ? res.data.banned_words.map(String) : [],
  };
}

// A campanha que vale hoje para o planejador. Falha de leitura não derruba o planejamento: segue pela rotação.
async function campaignToday(t: TenantDb, now: Date): Promise<Campaign | null> {
  try {
    const c = await activeCampaign(t, todayLocal(now));
    return c?.kind ? c : null;
  } catch (e) {
    log('warn', 'content-coordinator', 'não leu a campanha; segue pela rotação', { tenant: t.tenantId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// ── planning_runs: custo e idempotência por conta e dia ─────────────────────────────────────────────
type DayRow = { llmCalls: number; costUsd: number; suggested: number; fallback: boolean };

async function dayRow(t: TenantDb, day: string): Promise<DayRow | null> {
  const res = await t.select('planning_runs', 'llm_calls,cost_usd,suggested,fallback').eq('ran_on', day).maybeSingle();
  if (res.error) throw new Error(`planejamento: ${res.error.message}`);
  if (!res.data) return null;
  return { llmCalls: Number(res.data.llm_calls), costUsd: Number(res.data.cost_usd), suggested: Number(res.data.suggested), fallback: res.data.fallback === true };
}

async function recordPlanning(t: TenantDb, day: string, delta: Partial<DayRow>): Promise<void> {
  const cur = await dayRow(t, day);
  if (!cur) {
    const ins = await t.insert('planning_runs', { ran_on: day, llm_calls: delta.llmCalls ?? 0, cost_usd: delta.costUsd ?? 0, suggested: delta.suggested ?? 0, fallback: delta.fallback ?? false });
    // Outra rodada criou a linha agora: soma em cima dela.
    if (ins.error?.code === '23505') return recordPlanning(t, day, delta);
    if (ins.error) throw new Error(`planejamento: ${ins.error.message}`);
    return;
  }
  const res = await t
    .update('planning_runs', { llm_calls: cur.llmCalls + (delta.llmCalls ?? 0), cost_usd: cur.costUsd + (delta.costUsd ?? 0), suggested: cur.suggested + (delta.suggested ?? 0), fallback: cur.fallback || (delta.fallback ?? false) })
    .eq('ran_on', day);
  if (res.error) throw new Error(`planejamento: ${res.error.message}`);
}

// A rodada diária do job: quem reivindica o dia planeja; o resto pula. Uma rodada que falhou pode ser refeita.
async function claimRound(t: TenantDb, day: string, now: Date): Promise<boolean> {
  const stamp = now.toISOString();
  const ins = await t.insert('planning_runs', { ran_on: day, round_at: stamp });
  if (!ins.error) return true;
  if (ins.error.code !== '23505') throw new Error(`planejamento: ${ins.error.message}`);
  const fresh = await t.update('planning_runs', { round_at: stamp, status: 'done', error_code: null }).eq('ran_on', day).is('round_at', null).select('ran_on').maybeSingle();
  if (fresh.error) throw new Error(`planejamento: ${fresh.error.message}`);
  if (fresh.data) return true;
  const retry = await t.update('planning_runs', { round_at: stamp, status: 'done', error_code: null }).eq('ran_on', day).eq('status', 'failed').select('ran_on').maybeSingle();
  if (retry.error) throw new Error(`planejamento: ${retry.error.message}`);
  return !!retry.data;
}

async function failRound(t: TenantDb, day: string, e: unknown): Promise<void> {
  const code = (e instanceof Error ? e.name : 'erro').slice(0, 80);
  await t.update('planning_runs', { status: 'failed', error_code: code }).eq('ran_on', day).then(() => undefined, () => undefined);
}

type IdeasResult = { ideas: string[]; calls: number; costUsd: number; fallback: boolean };

// Uma chamada ao modelo de texto por rodada, com o que a campanha diz e só os fatos que valem hoje. A ideia que
// traz número fora dos fatos, "nunca afirmar" ou palavra proibida volta para o fallback, item a item. Sem modelo,
// com o teto de custo estourado ou com falha, tudo sai do próprio objetivo.
async function writeIdeas(
  t: TenantDb,
  planned: PlannedSuggestion[],
  photoText: Map<string, string | null>,
  dateName: Map<string, string>,
  models: ModelClient | null,
  campaign: Campaign | null,
): Promise<IdeasResult> {
  const items = planned.map((p, i) => ({ i, goal: p.goal, photo: p.assetId ? photoText.get(p.assetId) ?? null : null, date: p.dateKey ? dateName.get(p.dateKey) ?? null : null, campaign: p.campaignId !== null }));
  const fallback = (i: number) => {
    const it = items[i];
    return fallbackIdea(it.goal, it.photo, it.date, it.campaign ? campaign?.offering ?? null : null);
  };
  let ideas: (string | null)[] = items.map(() => null);
  let calls = 0;
  let costUsd = 0;
  if (models && items.length) {
    try {
      const [profile, factRows] = await Promise.all([profileOf(t), listFacts(t)]);
      const facts = factsForPrompt(factRows);
      const ideaCampaign: IdeaCampaign | null = campaign ? { name: campaign.name, objective: campaign.objective, offering: campaign.offering, audience: campaign.audience, restrictions: campaign.restrictions } : null;
      calls = 1;
      const out = await models.generateJson({
        prompt: ideasPrompt({ niche: profile.niche, offering: profile.offering, items, campaign: ideaCampaign, facts: facts.facts, never: facts.never }),
        labels: { tenant: t.tenantId, step: 'content_plan' },
        maxOutputTokens: 1200,
        temperature: 0.8,
      });
      costUsd = out.costUsd ?? 0;
      ideas = parseIdeas(out.json, items.length);
      let rejected = 0;
      ideas = ideas.map((idea, i) => {
        if (!idea) return null;
        const own = items[i].campaign && campaign?.offering ? [campaign.offering] : [];
        const problems = ideaProblems(idea, { facts: facts.facts, never: [...facts.never, ...(items[i].campaign && campaign ? campaign.restrictions : [])], banned: profile.bannedWords, inactive: facts.inactive, allowed: own });
        if (problems.length) rejected += 1;
        return problems.length ? null : idea;
      });
      log('info', 'content-coordinator', 'ideias escritas', { tenant: t.tenantId, count: items.length, rejected, costUsd });
    } catch (e) {
      log('warn', 'content-coordinator', 'não escreveu as ideias; usa o objetivo', { tenant: t.tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const final = items.map((_, i) => ideas[i] ?? fallback(i));
  return { ideas: final, calls, costUsd, fallback: ideas.some((x) => x === null) };
}

// Como foi o planejamento de hoje, para o Início explicar sem esconder: `failed` quando a rodada não terminou (a
// pessoa pode tentar de novo) e `simple` quando as ideias saíram do objetivo (modelo fora do ar ou teto de custo).
export type PlanningState = { failed: boolean; simple: boolean };

export async function planningState(t: TenantDb, now: Date = new Date()): Promise<PlanningState> {
  const res = await t.select('planning_runs', 'status,fallback').eq('ran_on', todayLocal(now)).maybeSingle();
  if (res.error || !res.data) return { failed: false, simple: false };
  return { failed: res.data.status === 'failed', simple: res.data.fallback === true };
}

export type PlanResult = { saved: Suggestion[]; llmCalls: number; costUsd: number; fallback: boolean };

// Planeja e grava as sugestões que faltam. `onlySlot` = replanejar um horário só (Trocar); `slotRule` diz se a
// nova sugestão segue no grupo da campanha ('campaign') ou da rotação ('free'), como a que saiu.
export async function planCore(t: TenantDb, deps: CoordinatorDeps = {}, onlySlot?: string, slotRule?: 'campaign' | 'free'): Promise<PlanResult> {
  const none: PlanResult = { saved: [], llmCalls: 0, costUsd: 0, fallback: false };
  const now = deps.now ?? new Date();
  const campaign = await campaignToday(t, now);
  const ctx = await loadContext(t, now, campaign?.id ?? null);
  if (!ctx) return none;
  const slots = onlySlot ? [onlySlot] : ctx.freeSlots;
  if (!slots.length) return none;

  const assets = await listMediaAssets(t, { filter: 'all', tag: null, limit: 500 });
  const photos = assets.filter((a) => isSuggestable(a, now) && !ctx.openAssetIds.has(a.id)).map((a) => ({ id: a.id, description: a.description, tags: a.tags }));
  const year = Number(new Date(now.getTime() + tzOffsetHours() * 3_600_000).toISOString().slice(0, 4));
  const dates = [...commemorativeDates(year), ...commemorativeDates(year + 1)];

  // Quantos horários desta rodada ainda cabem na campanha: a cota da semana menos o que ela já tem.
  const planCampaign: PlanCampaign | null = campaign?.kind
    ? { id: campaign.id, name: campaign.name, goals: KIND_GOALS[campaign.kind], remaining: onlySlot ? 0 : Math.max(0, campaignSlotQuota(ctx.totalSlots) - ctx.campaignMs.size), plannedTotal: ctx.campaignMs.size, offering: campaign.offering, existingSlots: [...ctx.campaignMs].map((ms) => new Date(ms).toISOString()) }
    : null;

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
    campaign: planCampaign,
    slotRules: onlySlot && slotRule ? { [new Date(onlySlot).toISOString()]: slotRule } : undefined,
  });
  if (!planned.length) return none;

  // Teto de custo: por conta e dia (as chamadas já gravadas em planning_runs) e, no job, por execução.
  const day = todayLocal(now);
  let models: ModelClient | null = null;
  if (deps.models !== undefined) models = deps.models;
  else {
    // Ambiente sem o projeto do modelo configurado: o planejamento não cai, as ideias saem do objetivo.
    try {
      models = vertexClient();
    } catch (e) {
      log('warn', 'content-coordinator', 'modelo não configurado: as ideias saem do objetivo', { tenant: t.tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const capped = models !== null && ((await dayRow(t, day))?.llmCalls ?? 0) >= MAX_LLM_CALLS_PER_DAY;
  const overBudget = models !== null && deps.budget !== undefined && deps.budget.remainingUsd() <= 0;
  if (capped || overBudget) {
    log('warn', 'content-coordinator', 'teto de custo: as ideias saem do objetivo', { tenant: t.tenantId, capped, overBudget });
    models = null;
  }
  const written = await writeIdeas(t, planned, new Map(photos.map((p) => [p.id, p.description])), new Map(dates.map((d) => [d.key, d.name])), models, campaign);

  const saved: Suggestion[] = [];
  for (const [i, p] of planned.entries()) {
    const res = await t
      .insert('content_suggestions', { channel: 'instagram', slot_at: p.slotAt, goal: p.goal, asset_id: p.assetId, date_key: p.dateKey, idea: written.ideas[i], reason: p.reason, campaign_id: p.campaignId, rule: p.rule })
      .select(COLUMNS)
      .single();
    // Outra rodada gravou este horário primeiro (índice único da sugestão aberta): segue.
    if (res.error?.code === '23505') continue;
    if (res.error) throw new Error(`sugestões: ${res.error.message}`);
    saved.push(toSuggestion(res.data!));
  }
  const fallbackUsed = capped || overBudget || written.fallback;
  await recordPlanning(t, day, { llmCalls: written.calls, costUsd: written.costUsd, suggested: saved.length, fallback: fallbackUsed });
  return { saved, llmCalls: written.calls, costUsd: written.costUsd, fallback: fallbackUsed };
}

export async function planForTenant(t: TenantDb, deps: CoordinatorDeps = {}, onlySlot?: string, slotRule?: 'campaign' | 'free'): Promise<Suggestion[]> {
  return (await planCore(t, deps, onlySlot, slotRule)).saved;
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
  // A nova segue no grupo da trocada: a de campanha continua de campanha, a de rotação continua de rotação.
  const [next] = await planForTenant(t, deps, current.slotAt, current.campaignId ? 'campaign' : 'free');
  return next ?? null;
}

// Criar este post. Sugestão com foto do banco não gera imagem: a tela abre o "Publicar foto"
// (BEZ-236) com a foto e a ideia. Sem foto, vira pedido de post com o objetivo.
export async function createFromSuggestion(
  t: TenantDb,
  actor: SessionUser | null,
  id: string,
  options: { wake?: () => void } = {},
): Promise<{ kind: 'photo'; assetId: string; idea: string; campaignId: string | null } | { kind: 'generate'; briefId: string }> {
  const s = await openSuggestion(t, id);
  if (s.assetId) {
    await decide(t, actor, id, { status: 'created' });
    return { kind: 'photo', assetId: s.assetId, idea: s.idea, campaignId: s.campaignId };
  }
  const { id: briefId } = await createPostRequest(t, actor, { idea: s.idea, goal: s.goal, kind: kindForGoal(s.goal), ratio: DEFAULT_RATIO, campaignId: s.campaignId });
  await decide(t, actor, id, { status: 'created', brief_id: briefId });
  (options.wake ?? wakeWorker)();
  return { kind: 'generate', briefId };
}

export type PlanningSummary = { accounts: number; suggested: number; paused: number; failed: number; skipped: number; fallback: number; costUsd: number };

// Teto de custo da execução, em dólares (PLAN_BUDGET_USD_PER_RUN). Sem a variável, não há teto por execução: o
// teto por conta e dia vale do mesmo jeito.
function runBudget(): number | null {
  const v = Number(process.env.PLAN_BUDGET_USD_PER_RUN);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Job de sistema: todas as contas com horário de Instagram. Uma conta que falha não para as outras. Cada conta é
// planejada uma vez por dia (planning_runs.round_at): rodar de novo no mesmo dia pula quem já passou.
export async function runContentPlanning(deps: CoordinatorDeps = {}): Promise<PlanningSummary> {
  // sistema: leitura entre tenants, só o dono dos horários
  const { data, error } = await db().from('publish_slots').select('tenant_id').eq('active', true).eq('channel', 'instagram').limit(5000);
  if (error) throw new Error(`horários: ${error.message}`);
  const now = deps.now ?? new Date();
  const day = todayLocal(now);
  const monday = new Date(now.getTime() + tzOffsetHours() * 3_600_000).getUTCDay() === 1;
  const summary: PlanningSummary = { accounts: 0, suggested: 0, paused: 0, failed: 0, skipped: 0, fallback: 0, costUsd: 0 };
  const cap = runBudget();
  const budget = deps.budget ?? (cap === null ? undefined : { remainingUsd: () => cap - summary.costUsd });
  for (const tenantId of new Set((data ?? []).map((r) => String(r.tenant_id)))) {
    const t = tenantDb(tenantId);
    if ((await getPauseState(t)).paused) {
      summary.paused += 1;
      continue;
    }
    try {
      if (!(await claimRound(t, day, now))) {
        summary.skipped += 1;
        continue;
      }
    } catch (e) {
      summary.failed += 1;
      log('error', 'content-coordinator', 'não reservou a rodada da conta', { tenant: tenantId, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    summary.accounts += 1;
    try {
      const out = await planCore(t, { ...deps, now, budget });
      summary.suggested += out.saved.length;
      summary.costUsd += out.costUsd;
      if (out.fallback) summary.fallback += 1;
      // Aviso semanal: na segunda, com o total de sugestões abertas da semana (não só as desta rodada).
      const open = monday && out.saved.length ? (await listSuggestions(t, now)).length : 0;
      if (open) {
        await notify(t, {
          kind: 'suggestions.week',
          title: 'Sugestões da semana prontas',
          body: `${open === 1 ? '1 post sugerido' : `${open} posts sugeridos`} para os próximos 7 dias, cada um com o motivo. Crie, troque ou pule.`,
          link: '/inicio',
          audience: 'team',
        });
      }
    } catch (e) {
      summary.failed += 1;
      await failRound(t, day, e);
      log('error', 'content-coordinator', 'não planejou a conta', { tenant: tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
