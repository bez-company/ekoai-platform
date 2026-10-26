// audience.ts: lê o público da conta no Instagram e guarda uma linha por dia em audience_snapshots
// (SPEC 022, BEZ-206). Roda junto da coleta de métricas (/api/cron/collect-metrics), no máximo uma vez por
// dia e conta. Faixa etária, gênero e horário online exigem a permissão de insights e 100 seguidores; o
// que não vier fica nulo e o `status` explica por quê. O token nunca vai para o log. Server-only.

import { GRAPH_URL } from './instagram-oauth-model';
import { INSIGHTS_SCOPE } from './instagram-metrics-model';
import { log } from './log';
import type { SecretBox } from './secret-box';
import { listMetricsAccounts, openAccountToken, type MetricsAccount } from './social-accounts';
import { tenantDb, type TenantDb } from './tenant-db';
import {
  MIN_FOLLOWERS,
  audienceFailure,
  parseDemographics,
  parseFollowers,
  parseOnlineHours,
  resolveStatus,
  type Audience,
  type AudienceStatus,
} from './audience-model';

export type AudienceSummary = { accounts: number; saved: number; skipped: number; failed: number };

type Deps = { box?: SecretBox; fetchFn?: typeof fetch; nowMs?: number };

// A documentação da Meta lista `this_month` como os últimos 30 dias e ainda mostra `last_30_days` no exemplo
// da versão atual; tenta o primeiro e, se a Meta recusar o parâmetro, o segundo.
const TIMEFRAMES = ['this_month', 'last_30_days'] as const;

class GraphFailed extends Error {
  constructor(public readonly kind: ReturnType<typeof audienceFailure>, public readonly body: unknown) {
    super(`Graph API: ${kind}`);
  }
}

async function graphGet(fetchFn: typeof fetch, path: string, params: Record<string, string>, token: string): Promise<unknown> {
  const url = new URL(`${GRAPH_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new GraphFailed(audienceFailure(json), json);
  return json;
}

async function demographics(fetchFn: typeof fetch, igUserId: string, token: string, breakdown: 'age' | 'gender'): Promise<{ values: Record<string, number> | null; raw: unknown }> {
  let last: unknown = null;
  for (const timeframe of TIMEFRAMES) {
    try {
      const json = await graphGet(fetchFn, `${igUserId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown, timeframe }, token);
      return { values: parseDemographics(json, breakdown), raw: json };
    } catch (e) {
      if (!(e instanceof GraphFailed)) throw e;
      last = e.body;
      // Só o parâmetro recusado ("other") merece a segunda tentativa; token, permissão e poucos seguidores não.
      if (e.kind !== 'other') throw e;
    }
  }
  throw new GraphFailed('other', last);
}

// O que a Meta respondeu de errado em cada campo, para o log: nunca leva token (a Meta não o devolve) e a
// mensagem é cortada. Serve para o BEZ-326: saber, com conta real, o que a Meta devolve de verdade.
export type FieldFailure = { field: 'followers' | 'age' | 'gender' | 'online_followers'; kind: string; code: number | null; message: string | null };

export type AudienceReading = { audience: Audience; raw: Record<string, unknown>; failures: FieldFailure[] };

function failureOf(field: FieldFailure['field'], e: GraphFailed): FieldFailure {
  const err = e.body && typeof e.body === 'object' ? (e.body as { error?: { code?: unknown; message?: unknown } }).error : null;
  return { field, kind: e.kind, code: typeof err?.code === 'number' ? err.code : null, message: typeof err?.message === 'string' ? err.message.slice(0, 200) : null };
}

// Lê tudo o que a Meta entrega do público. Erro de token sobe para quem chama; permissão e poucos
// seguidores viram estado; qualquer outro erro de um campo deixa só aquele campo nulo.
export async function readAudience(fetchFn: typeof fetch, igUserId: string, token: string, insights: boolean): Promise<AudienceReading> {
  const raw: Record<string, unknown> = {};
  const failures: FieldFailure[] = [];
  let followers: number | null = null;
  try {
    const me = await graphGet(fetchFn, igUserId, { fields: 'followers_count' }, token);
    followers = parseFollowers(me);
  } catch (e) {
    if (e instanceof GraphFailed && e.kind === 'token') throw e;
    raw.followers_error = e instanceof GraphFailed ? e.kind : 'other';
    if (e instanceof GraphFailed) failures.push(failureOf('followers', e));
  }
  const audience: Audience = { followers, age: null, gender: null, onlineHours: null, status: 'unavailable' };
  let tooFew = followers !== null && followers < MIN_FOLLOWERS;
  let denied = false;
  if (insights && !tooFew) {
    for (const breakdown of ['age', 'gender'] as const) {
      try {
        const { values, raw: body } = await demographics(fetchFn, igUserId, token, breakdown);
        if (breakdown === 'age') audience.age = values as Audience['age'];
        else audience.gender = values as Audience['gender'];
        raw[breakdown] = body;
      } catch (e) {
        if (!(e instanceof GraphFailed)) throw e;
        if (e.kind === 'token') throw e;
        if (e.kind === 'too_few_followers') tooFew = true;
        if (e.kind === 'permission') denied = true;
        raw[`${breakdown}_error`] = e.kind;
        failures.push(failureOf(breakdown, e));
      }
    }
    if (!tooFew) {
      try {
        const json = await graphGet(fetchFn, `${igUserId}/insights`, { metric: 'online_followers', period: 'lifetime' }, token);
        audience.onlineHours = parseOnlineHours(json);
        raw.online_followers = json;
      } catch (e) {
        if (!(e instanceof GraphFailed)) throw e;
        if (e.kind === 'token') throw e;
        raw.online_followers_error = e.kind;
        failures.push(failureOf('online_followers', e));
      }
    }
  }
  // A pessoa pode ter retirado a permissão no Instagram depois de concedê-la: a Meta responde "permissão".
  audience.status = resolveStatus(audience, insights && !denied, tooFew);
  return { audience, raw, failures };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Já leu hoje e o resultado não muda sozinho (ok ou poucos seguidores)? Sem permissão ou indisponível
// tenta de novo na próxima rodada: a pessoa pode ter concedido a permissão no meio do dia.
async function doneToday(t: TenantDb, day: string): Promise<boolean> {
  const { data, error } = await t.select('audience_snapshots', 'status').eq('channel', 'instagram').eq('captured_on', day).limit(1);
  if (error) throw new Error(`audience_snapshots: ${error.message}`);
  const status = (data?.[0]?.status as AudienceStatus | undefined) ?? null;
  return status === 'ok' || status === 'too_few_followers';
}

async function collectAccount(account: MetricsAccount, deps: Required<Pick<Deps, 'fetchFn' | 'nowMs'>> & Pick<Deps, 'box'>, summary: AudienceSummary): Promise<void> {
  const t = tenantDb(account.tenantId);
  const day = dayOf(deps.nowMs);
  if (await doneToday(t, day)) {
    summary.skipped += 1;
    return;
  }
  const token = await openAccountToken(account.id, deps.box);
  const { audience, raw, failures } = await readAudience(deps.fetchFn, account.externalId, token, account.scopes.includes(INSIGHTS_SCOPE));
  // Uma linha por conta e leitura: o estado do dia e o que a Meta recusou, sem dado de seguidor nenhum.
  log('info', 'audience', 'leitura do público', {
    account: account.id,
    status: audience.status,
    followers: audience.followers,
    hasAge: audience.age !== null,
    hasGender: audience.gender !== null,
    hasOnlineHours: audience.onlineHours !== null,
    failures,
  });
  const { error } = await t.upsert(
    'audience_snapshots',
    {
      channel: 'instagram',
      captured_on: day,
      followers: audience.followers,
      age: audience.age,
      gender: audience.gender,
      online_hours: audience.onlineHours,
      status: audience.status,
      raw,
    },
    { onConflict: 'tenant_id,channel,captured_on' },
  );
  if (error) throw new Error(`audience_snapshots: ${error.message}`);
  summary.saved += 1;
}

export async function runAudienceCollection(deps: Deps = {}): Promise<AudienceSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const summary: AudienceSummary = { accounts: 0, saved: 0, skipped: 0, failed: 0 };
  for (const account of await listMetricsAccounts()) {
    summary.accounts += 1;
    try {
      await collectAccount(account, { box: deps.box, fetchFn, nowMs }, summary);
    } catch (e) {
      summary.failed += 1;
      const token = e instanceof GraphFailed && e.kind === 'token';
      log('warn', 'audience', token ? 'token recusado; a renovação diária pede para reconectar' : 'leitura do público falhou; tenta de novo na próxima rodada', {
        account: account.id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return summary;
}

// ── Leitura para a tela de Análise ─────────────────────────────────────────────────────────────

export type AudienceView = Audience & { capturedOn: string };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// A leitura mais recente com algum dado; sem nenhuma, a mais recente de qualquer estado (a tela explica o porquê).
export async function latestAudience(t: TenantDb): Promise<AudienceView | null> {
  const { data, error } = await t
    .select('audience_snapshots', 'captured_on,followers,age,gender,online_hours,status')
    .eq('channel', 'instagram')
    .order('captured_on', { ascending: false })
    .limit(30);
  if (error) throw new Error(`audience_snapshots: ${error.message}`);
  const rows = data ?? [];
  const row = rows.find((r) => r.status === 'ok') ?? rows[0];
  if (!row) return null;
  return {
    capturedOn: String(row.captured_on).slice(0, 10),
    followers: num(row.followers),
    age: (row.age as AudienceView['age']) ?? null,
    gender: (row.gender as AudienceView['gender']) ?? null,
    onlineHours: Array.isArray(row.online_hours) ? (row.online_hours as number[]) : null,
    status: row.status as AudienceStatus,
  };
}
