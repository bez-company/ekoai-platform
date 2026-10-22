// home-summary.ts: o que o painel do Início lê do banco (SPEC 017, decisão 3; BEZ-232). As regras
// ficam em home-model.ts; aqui só consultas pelo tenantDb.

import type { TenantDb } from './tenant-db';
import { getPauseState } from './pause';
import { latestPostMetrics, type PostMetricsView } from './instagram-metrics';
import { daysUntil, nextStep, type HomeCan, type HomeFacts, type NextStep } from './home-model';

export type WeekPost = { id: string; scheduledFor: string; imageUrl: string | null; caption: string };
export type LastPublished = { id: string; postId: string | null; publishedAt: string; imageUrl: string | null; caption: string; metrics: PostMetricsView | null };

export type HomeSummary = {
  next: NextStep | null;
  week: WeekPost[]; // próximos 7 dias, em ordem
  lastPublished: LastPublished | null;
  counts: { pending: number; scheduled: number; queued: number; failed: number };
};

const WEEK_MS = 7 * 86_400_000;
const iso = (v: unknown): string => new Date(v as string).toISOString();

function check<T>(r: { data: T | null; error: { message: string } | null; count?: number | null }, what: string) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r;
}

export async function homeSummary(t: TenantDb, can: HomeCan, nowMs = Date.now()): Promise<HomeSummary> {
  const count = (table: string) => t.select(table, 'id', { count: 'exact', head: true });
  const nowIso = new Date(nowMs).toISOString();
  const weekEnd = new Date(nowMs + WEEK_MS).toISOString();

  const [pending, scheduled, queued, failed, slots, accounts, week, last, pause] = await Promise.all([
    count('pending_approvals'),
    count('scheduled_posts').eq('status', 'scheduled'),
    count('scheduled_posts').eq('status', 'queued'),
    count('scheduled_posts').eq('status', 'failed'),
    t.select('publish_slots', 'id').eq('channel', 'instagram').eq('active', true).limit(1),
    t.select('social_accounts', 'status,expires_at').eq('channel', 'instagram').neq('status', 'revoked').order('connected_at', { ascending: false }),
    t
      .select('scheduled_posts', 'id,scheduled_for,image_url,caption_final')
      .eq('status', 'scheduled')
      .gte('scheduled_for', nowIso)
      .lte('scheduled_for', weekEnd)
      .order('scheduled_for', { ascending: true })
      .limit(7),
    t.select('scheduled_posts', 'id,post_id,published_at,image_url,caption_final').eq('status', 'published').order('published_at', { ascending: false }).limit(1),
    getPauseState(t),
  ]);
  for (const [r, what] of [[pending, 'pending_approvals'], [scheduled, 'scheduled_posts'], [queued, 'scheduled_posts'], [failed, 'scheduled_posts'], [slots, 'publish_slots'], [accounts, 'social_accounts'], [week, 'scheduled_posts'], [last, 'scheduled_posts']] as const) {
    check(r, what);
  }

  // Uma conexão ativa vale mais que uma que precisa reconectar (a publicação usa a ativa).
  const rows = (accounts.data ?? []) as { status: string; expires_at: string | null }[];
  const active = rows.find((r) => r.status === 'active');
  const facts: HomeFacts = {
    instagram: active ? 'active' : rows.some((r) => r.status === 'reauth_required') ? 'reauth_required' : 'none',
    instagramExpiresInDays: active ? daysUntil(active.expires_at ? iso(active.expires_at) : null, nowMs) : null,
    failed: failed.count ?? 0,
    paused: pause.paused,
    scheduled: scheduled.count ?? 0,
    queued: queued.count ?? 0,
    pending: pending.count ?? 0,
    hasSlots: (slots.data ?? []).length > 0,
    scheduledThisWeek: (week.data ?? []).length,
  };

  const weekPosts: WeekPost[] = ((week.data ?? []) as { id: string; scheduled_for: string; image_url: string | null; caption_final: string }[]).map((r) => ({
    id: String(r.id),
    scheduledFor: iso(r.scheduled_for),
    imageUrl: r.image_url ?? null,
    caption: r.caption_final,
  }));

  const l = (last.data?.[0] ?? null) as { id: string; post_id: string | null; published_at: string; image_url: string | null; caption_final: string } | null;
  let lastPublished: LastPublished | null = null;
  if (l) {
    const metrics = l.post_id ? (await latestPostMetrics(t, [String(l.post_id)]))[String(l.post_id)] ?? null : null;
    lastPublished = { id: String(l.id), postId: l.post_id ? String(l.post_id) : null, publishedAt: iso(l.published_at), imageUrl: l.image_url ?? null, caption: l.caption_final, metrics };
  }

  return {
    next: nextStep(facts, can),
    week: weekPosts,
    lastPublished,
    counts: { pending: facts.pending, scheduled: facts.scheduled, queued: facts.queued, failed: facts.failed },
  };
}
