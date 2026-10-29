// usage-posts.ts: a lista de posts do mês e o detalhe de um post, lidos do banco (SPEC 031, entrega 2). Só leitura, sempre pelo tenantDb:
// outra conta nunca aparece e um id de outra conta é "não encontrado". Um post é um pedido pronto ou aprovado (uma ideia, em qualquer
// número de redes). Nada daqui tem preço ou custo.

import type { TenantDb } from './tenant-db';
import { monthRange, type MonthKey } from './usage-model';
import { POSTS_PER_PAGE, postStateOf, postTitle, sortChannels, type PostActivity, type PostList, type PostRow } from './usage-posts-model';
import type { Channel } from './types';

const POST_STATUSES = ['ready', 'approved'];
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

type Link = { brief_id: string; channel: string; status?: string };

// As publicações e as pendências de cada pedido, de uma vez só para a página inteira.
async function linksOf(t: TenantDb, ids: string[]): Promise<{ scheduled: Link[]; pendings: Link[] }> {
  if (!ids.length) return { scheduled: [], pendings: [] };
  const [scheduled, pendings] = await Promise.all([t.select('scheduled_posts', 'brief_id,channel,status').in('brief_id', ids), t.select('pending_approvals', 'brief_id,channel').in('brief_id', ids)]);
  if (scheduled.error) throw new Error(`scheduled_posts: ${scheduled.error.message}`);
  if (pendings.error) throw new Error(`pending_approvals: ${pendings.error.message}`);
  return { scheduled: (scheduled.data ?? []) as Link[], pendings: (pendings.data ?? []) as Link[] };
}

export async function monthPosts(t: TenantDb, month: MonthKey, limit = POSTS_PER_PAGE): Promise<PostList> {
  const { start, end } = monthRange(month);
  const [total, briefs] = await Promise.all([
    t.select('briefs', 'id', { count: 'exact', head: true }).in('status', POST_STATUSES).gte('created_at', start).lt('created_at', end),
    t.select('briefs', 'id,idea,created_at,channels').in('status', POST_STATUSES).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(limit),
  ]);
  if (total.error) throw new Error(`briefs: ${total.error.message}`);
  if (briefs.error) throw new Error(`briefs: ${briefs.error.message}`);
  const list = briefs.data ?? [];
  const { scheduled, pendings } = await linksOf(t, list.map((b) => String(b.id)));
  const rows: PostRow[] = list.map((b) => {
    const id = String(b.id);
    const mine = scheduled.filter((s) => s.brief_id === id);
    const waiting = pendings.filter((p) => p.brief_id === id);
    const channels = sortChannels([...mine.map((s) => s.channel), ...waiting.map((p) => p.channel)]);
    return {
      id,
      title: postTitle(String(b.idea ?? '')),
      createdAt: iso(b.created_at),
      // Pedido sem publicação nem pendência (recusado): vale o que a pessoa pediu.
      channels: channels.length ? channels : sortChannels(Array.isArray(b.channels) ? (b.channels as string[]) : ['instagram']),
      state: postStateOf(mine.map((s) => String(s.status)), waiting.length),
    };
  });
  return { total: total.count ?? rows.length, rows };
}

// O detalhe de um post. `null` quando o pedido não existe nesta conta ou ainda não é um post (falhou, está na fila).
export async function postActivity(t: TenantDb, briefId: string): Promise<PostActivity | null> {
  const brief = await t.select('briefs', 'id,idea,created_at,channels').eq('id', briefId).in('status', POST_STATUSES).maybeSingle();
  if (brief.error) throw new Error(`briefs: ${brief.error.message}`);
  if (!brief.data) return null;
  const [runs, links, designs] = await Promise.all([
    t.select('generation_runs', 'step,channel,status,images').eq('brief_id', briefId).eq('status', 'done'),
    linksOf(t, [briefId]),
    t.select('post_designs', 'id').eq('brief_id', briefId),
  ]);
  if (runs.error) throw new Error(`generation_runs: ${runs.error.message}`);
  if (designs.error) throw new Error(`post_designs: ${designs.error.message}`);
  const designIds = (designs.data ?? []).map((d) => String(d.id));
  let designEdits = 0;
  if (designIds.length) {
    const edits = await t.select('post_design_revisions', 'id', { count: 'exact', head: true }).in('post_design_id', designIds).in('source', ['edit', 'layout', 'restore']);
    if (edits.error) throw new Error(`post_design_revisions: ${edits.error.message}`);
    designEdits = edits.count ?? 0;
  }
  const done = runs.data ?? [];
  const mine = links.scheduled.filter((s) => s.brief_id === briefId);
  const channels = sortChannels([...mine.map((s) => s.channel), ...links.pendings.map((p) => p.channel)]);
  return {
    title: postTitle(String(brief.data.idea ?? '')),
    createdAt: iso(brief.data.created_at),
    channels: channels.length ? channels : sortChannels(Array.isArray(brief.data.channels) ? (brief.data.channels as string[]) : ['instagram']),
    state: postStateOf(mine.map((s) => String(s.status)), links.pendings.length),
    generatedImages: done.filter((r) => r.step === 'visual').reduce((n, r) => n + (Number(r.images) || 0), 0),
    evaluated: sortChannels(done.filter((r) => r.step === 'critic').map((r) => String(r.channel))),
    publications: mine.map((s) => ({ channel: s.channel as Channel, status: String(s.status) })),
    designEdits,
    fixes: done.filter((r) => r.step === 'fix').length,
  };
}
