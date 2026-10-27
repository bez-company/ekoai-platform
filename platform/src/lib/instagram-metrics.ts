// instagram-metrics.ts: coleta as métricas dos posts publicados no Instagram (BEZ-183). Roda pelo Cloud
// Scheduler (/api/cron/collect-metrics). Para cada conta com Instagram ativo: abre o token (Cloud KMS),
// lê curtidas e comentários de cada post dos últimos 30 dias e, quando a pessoa concedeu a permissão de
// insights, também alcance, salvos, compartilhamentos, visualizações e interações. Cada coleta vira uma
// linha em metrics_snapshots. O token nunca vai para o log. Server-only.

import { GRAPH_URL } from './instagram-oauth-model';
import { log } from './log';
import type { SecretBox } from './secret-box';
import { listMetricsAccounts, openAccountToken, type MetricsAccount } from './social-accounts';
import { tenantDb, type TenantDb } from './tenant-db';
import {
  EMPTY_METRICS,
  INSIGHTS_SCOPE,
  INSIGHT_METRICS,
  WINDOW_DAYS,
  engagementRate,
  graphFailure,
  isDue,
  mediaIdOf,
  parseInsights,
  parseMediaFields,
  type GraphFailure,
  type PostMetrics,
} from './instagram-metrics-model';

export type MetricsSummary = { accounts: number; collected: number; skipped: number; gone: number; failed: number };

type Deps = { box?: SecretBox; fetchFn?: typeof fetch; nowMs?: number };

const POSTS_PER_ACCOUNT = 100;

class GraphError extends Error {
  constructor(public readonly kind: GraphFailure) {
    super(`Graph API: ${kind}`);
  }
}

async function graphGet(fetchFn: typeof fetch, path: string, params: Record<string, string>, token: string): Promise<unknown> {
  const url = new URL(`${GRAPH_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new GraphError(graphFailure(json));
  return json;
}

async function readMetrics(fetchFn: typeof fetch, mediaId: string, token: string, insights: boolean): Promise<{ metrics: PostMetrics; raw: Record<string, unknown> }> {
  const fields = await graphGet(fetchFn, mediaId, { fields: 'like_count,comments_count' }, token);
  const metrics: PostMetrics = { ...EMPTY_METRICS, ...parseMediaFields(fields) };
  const raw: Record<string, unknown> = { fields };
  if (insights) {
    try {
      const ins = await graphGet(fetchFn, `${mediaId}/insights`, { metric: INSIGHT_METRICS.join(',') }, token);
      Object.assign(metrics, parseInsights(ins));
      raw.insights = ins;
    } catch (e) {
      // Sem insights a coleta segue com curtidas e comentários; token ruim derruba a conta inteira.
      if (e instanceof GraphError && e.kind === 'token') throw e;
      raw.insights_error = e instanceof GraphError ? e.kind : 'other';
    }
  }
  return { metrics, raw };
}

async function lastCaptures(t: TenantDb, postIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!postIds.length) return out;
  const { data, error } = await t.select('metrics_snapshots', 'post_id,captured_at').in('post_id', postIds).order('captured_at', { ascending: false });
  if (error) throw new Error(`metrics_snapshots: ${error.message}`);
  for (const r of data ?? []) {
    const id = String(r.post_id);
    if (!out.has(id)) out.set(id, new Date(r.captured_at as string).toISOString());
  }
  return out;
}

async function collectAccount(account: MetricsAccount, deps: Required<Pick<Deps, 'fetchFn' | 'nowMs'>> & Pick<Deps, 'box'>, summary: MetricsSummary): Promise<void> {
  const t = tenantDb(account.tenantId);
  const since = new Date(deps.nowMs - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await t
    .select('posts', 'id,channels,published_at')
    .eq('channel', 'instagram')
    .eq('is_dry_run', false)
    .is('removed_at', null)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(POSTS_PER_ACCOUNT);
  if (error) throw new Error(`posts: ${error.message}`);
  const posts = (data ?? []).map((r) => ({ id: String(r.id), mediaId: mediaIdOf(r.channels), publishedAt: new Date(r.published_at as string).toISOString() }));
  const last = await lastCaptures(t, posts.map((p) => p.id));
  const due = posts.filter((p) => p.mediaId && isDue(p.publishedAt, last.get(p.id) ?? null, deps.nowMs));
  summary.skipped += posts.length - due.length;
  if (!due.length) return;

  const token = await openAccountToken(account.id, deps.box);
  const insights = account.scopes.includes(INSIGHTS_SCOPE);
  for (const p of due) {
    try {
      const { metrics, raw } = await readMetrics(deps.fetchFn, p.mediaId!, token, insights);
      const ins = await t.insert('metrics_snapshots', {
        post_id: p.id,
        channel: 'instagram',
        likes: metrics.likes,
        comments: metrics.comments,
        saves: metrics.saves,
        shares: metrics.shares,
        reach: metrics.reach,
        views: metrics.views,
        total_interactions: metrics.interactions,
        engagement_score: engagementRate(metrics),
        raw,
        captured_at: new Date(deps.nowMs).toISOString(),
      });
      if (ins.error) throw new Error(`metrics_snapshots: ${ins.error.message}`);
      summary.collected += 1;
    } catch (e) {
      if (e instanceof GraphError && e.kind === 'token') {
        summary.failed += 1;
        log('warn', 'instagram-metrics', 'token recusado; a renovação diária pede para reconectar', { account: account.id });
        return;
      }
      if (e instanceof GraphError && e.kind === 'gone') {
        // Apagado no Instagram: sai de Publicados (a linha e o histórico ficam).
        summary.gone += 1;
        const removed = await t.update('posts', { removed_at: new Date(deps.nowMs).toISOString() }).eq('id', p.id).is('removed_at', null);
        if (removed.error) log('warn', 'instagram-metrics', 'não marcou o post apagado no Instagram', { post: p.id, reason: removed.error.message });
        continue;
      }
      summary.failed += 1;
      log('warn', 'instagram-metrics', 'coleta de um post falhou; tenta de novo na próxima rodada', { post: p.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function runMetricsCollection(deps: Deps = {}): Promise<MetricsSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const summary: MetricsSummary = { accounts: 0, collected: 0, skipped: 0, gone: 0, failed: 0 };
  for (const account of await listMetricsAccounts()) {
    summary.accounts += 1;
    try {
      await collectAccount(account, { box: deps.box, fetchFn, nowMs }, summary);
    } catch (e) {
      summary.failed += 1;
      log('warn', 'instagram-metrics', 'coleta da conta falhou; tenta de novo na próxima rodada', { account: account.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}

// ── Leitura para o Histórico (BEZ-238) ──────────────────────────────────────────────────────

export type PostMetricsView = PostMetrics & { engagement: number | null; capturedAt: string };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// A última coleta de cada post pedido. Post sem coleta não aparece no resultado.
export async function latestPostMetrics(t: TenantDb, postIds: string[]): Promise<Record<string, PostMetricsView>> {
  const out: Record<string, PostMetricsView> = {};
  if (!postIds.length) return out;
  const { data, error } = await t
    .select('metrics_snapshots', 'post_id,likes,comments,saves,shares,reach,views,total_interactions,captured_at')
    .in('post_id', postIds)
    .order('captured_at', { ascending: false });
  if (error) throw new Error(`metrics_snapshots: ${error.message}`);
  for (const r of data ?? []) {
    const id = String(r.post_id);
    if (out[id]) continue;
    const m: PostMetrics = {
      likes: num(r.likes),
      comments: num(r.comments),
      saves: num(r.saves),
      shares: num(r.shares),
      reach: num(r.reach),
      views: num(r.views),
      interactions: num(r.total_interactions),
    };
    out[id] = { ...m, engagement: engagementRate(m), capturedAt: new Date(r.captured_at as string).toISOString() };
  }
  return out;
}
