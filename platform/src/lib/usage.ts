// usage.ts: o uso da conta num mês, lido do banco (SPEC 031, BEZ-456). Só leitura, sempre pelo tenantDb: outra conta nunca aparece.
// Posts são pedidos prontos (uma ideia, um post, em qualquer número de redes); publicações são as linhas publicadas por rede; imagens são
// as geradas por modelo (`visual`); ajustes são as versões de design editadas e os consertos do avaliador. Nada disto tem preço.

import type { TenantDb } from './tenant-db';
import { emptyUsage, monthRange, USAGE_CHANNELS, type MonthKey, type MonthUsage } from './usage-model';
import type { Channel } from './types';

async function count(promise: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string): Promise<number> {
  const { count: n, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return n ?? 0;
}

export async function monthUsage(t: TenantDb, month: MonthKey, now: Date = new Date()): Promise<MonthUsage> {
  const { start, end } = monthRange(month);
  const usage = emptyUsage(month, now);

  const [posts, images, fixes, revisions, people, ...published] = await Promise.all([
    count(t.select('briefs', 'id', { count: 'exact', head: true }).in('status', ['ready', 'approved']).gte('created_at', start).lt('created_at', end), 'briefs'),
    t.select('generation_runs', 'images').eq('step', 'visual').eq('status', 'done').gte('created_at', start).lt('created_at', end),
    count(t.select('generation_runs', 'id', { count: 'exact', head: true }).eq('step', 'fix').eq('status', 'done').gte('created_at', start).lt('created_at', end), 'generation_runs'),
    count(t.select('post_design_revisions', 'id', { count: 'exact', head: true }).in('source', ['edit', 'layout', 'restore']).gte('created_at', start).lt('created_at', end), 'post_design_revisions'),
    usage.isCurrent ? count(t.select('tenant_members', 'user_id', { count: 'exact', head: true }), 'tenant_members') : Promise.resolve(null),
    ...USAGE_CHANNELS.map((c) => count(t.select('scheduled_posts', 'id', { count: 'exact', head: true }).eq('channel', c).eq('status', 'published').gte('published_at', start).lt('published_at', end), 'scheduled_posts')),
  ]);

  if (images.error) throw new Error(`generation_runs: ${images.error.message}`);
  usage.posts = posts;
  usage.images = (images.data ?? []).reduce((n, r) => n + (Number(r.images) || 0), 0);
  usage.adjustments = fixes + revisions;
  usage.people = people;
  USAGE_CHANNELS.forEach((c: Channel, i) => {
    usage.publications[c] = published[i];
  });
  return usage;
}
