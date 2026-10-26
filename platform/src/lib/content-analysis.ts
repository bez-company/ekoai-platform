// content-analysis.ts: junta o que a tela Publicados › Analytics precisa (SPEC 022, BEZ-206): os posts dos
// últimos 60 dias com tipo, formato, objetivo e engajamento, o público da conta e a conta do Instagram.
// Server-only. As regras de comparação e de horário ficam em content-analysis-model.ts (puras).

import { latestAudience, type AudienceView } from './audience';
import { INSIGHTS_SCOPE } from './instagram-metrics-model';
import { latestPostMetrics } from './instagram-metrics';
import { isPostGoal } from './post-goals';
import { listSocialAccounts } from './social-accounts';
import { tzOffsetHours } from './slots';
import { titleOf } from './published-feed';
import type { TenantDb } from './tenant-db';
import {
  WINDOW_DAYS,
  contentBreakdown,
  insightSentence,
  ownHourly,
  recommendSlots,
  type AnalysisPost,
  type Breakdown,
  type PostKind,
  type Recommendation,
} from './content-analysis-model';

export type Analysis = {
  // Há uma conta de Instagram ativa, e ela concedeu a permissão de insights.
  connected: boolean;
  insights: boolean;
  posts: AnalysisPost[];
  breakdown: Breakdown;
  insight: { text: string; evidence: string } | null;
  recommendation: Recommendation;
  audience: AudienceView | null;
  tzOffsetHours: number;
  // Engajamento médio por hora de publicação (0 a 1 relativo ao melhor), nulo onde não há post.
  ownHours: (number | null)[];
};

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

// posts.format antigo ('single', 'carousel'...) para o vocabulário de media_kind.
const FORMAT_FALLBACK: Record<string, string> = { single: 'image', carousel: 'carousel', text: 'text', thread: 'thread' };

type PostRow = { id: string; hook: string | null; body: string | null; format: string | null; published_at: string | Date | null; scheduled_post_id: string | null };

async function listAnalysisPosts(t: TenantDb, nowMs: number): Promise<AnalysisPost[]> {
  const since = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await t
    .select('posts', 'id,hook,body,format,published_at,scheduled_post_id')
    .eq('channel', 'instagram')
    .eq('is_dry_run', false)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`posts: ${error.message}`);
  const rows = ((data ?? []) as unknown as PostRow[]).filter((r) => r.published_at !== null);
  if (!rows.length) return [];

  const scheduledIds = rows.map((r) => r.scheduled_post_id).filter((id): id is string => !!id);
  const scheduled = new Map<string, { briefId: string | null; mediaKind: string | null; caption: string | null }>();
  if (scheduledIds.length) {
    const res = await t.select('scheduled_posts', 'id,brief_id,media_kind,caption_final').in('id', scheduledIds);
    if (res.error) throw new Error(`scheduled_posts: ${res.error.message}`);
    for (const r of res.data ?? []) scheduled.set(String(r.id), { briefId: (r.brief_id as string | null) ?? null, mediaKind: (r.media_kind as string | null) ?? null, caption: (r.caption_final as string | null) ?? null });
  }

  const briefIds = [...new Set([...scheduled.values()].map((s) => s.briefId).filter((id): id is string => !!id))];
  const goals = new Map<string, string | null>();
  const kinds = new Map<string, PostKind>();
  if (briefIds.length) {
    const [b, d] = await Promise.all([
      t.select('briefs', 'id,goal').in('id', briefIds),
      t.select('post_designs', 'brief_id,kind,created_at').in('brief_id', briefIds).order('created_at', { ascending: true }),
    ]);
    if (b.error) throw new Error(`briefs: ${b.error.message}`);
    if (d.error) throw new Error(`post_designs: ${d.error.message}`);
    for (const r of b.data ?? []) goals.set(String(r.id), (r.goal as string | null) ?? null);
    // O design mais recente do pedido manda (a ordem crescente faz o último sobrescrever).
    for (const r of d.data ?? []) if (r.kind === 'informativo' || r.kind === 'atmosfera') kinds.set(String(r.brief_id), r.kind);
  }

  const metrics = await latestPostMetrics(t, rows.map((r) => r.id));
  return rows.map((r) => {
    const s = r.scheduled_post_id ? scheduled.get(r.scheduled_post_id) : undefined;
    const goal = s?.briefId ? goals.get(s.briefId) ?? null : null;
    const caption = s?.caption ?? [r.hook, r.body].filter(Boolean).join('\n\n');
    return {
      id: String(r.id),
      title: titleOf(r.hook, caption),
      publishedAt: iso(r.published_at) as string,
      kind: s?.briefId ? kinds.get(s.briefId) ?? null : null,
      format: s?.mediaKind ?? (r.format ? FORMAT_FALLBACK[r.format] ?? null : null),
      goal: isPostGoal(goal) ? goal : null,
      engagement: metrics[String(r.id)]?.engagement ?? null,
    };
  });
}

export async function loadAnalysis(t: TenantDb, nowMs = Date.now()): Promise<Analysis> {
  const tz = tzOffsetHours();
  const [accounts, posts, audience] = await Promise.all([listSocialAccounts(t), listAnalysisPosts(t, nowMs), latestAudience(t)]);
  const active = accounts.find((a) => a.channel === 'instagram' && a.status === 'active');
  const breakdown = contentBreakdown(posts);
  return {
    connected: !!active,
    insights: !!active && active.scopes.includes(INSIGHTS_SCOPE) && audience?.status !== 'no_permission',
    posts,
    breakdown,
    insight: insightSentence(breakdown),
    recommendation: recommendSlots(posts, { tzOffsetHours: tz, onlineHours: audience?.onlineHours ?? null }),
    audience,
    tzOffsetHours: tz,
    ownHours: ownHourly(posts, tz),
  };
}
