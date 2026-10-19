// queries.ts: leituras (lado read) usadas pelos Server Components, sempre do tenant da sessão.

import type { TenantDb } from './tenant-db';
import type { PendingApproval, ScheduledPost, PublishedPost, PublishSlot, Campaign } from './types';

export async function getPendings(t: TenantDb): Promise<PendingApproval[]> {
  const { data, error } = await t
    .select('pending_approvals')
    .order('saved_at', { ascending: false });
  if (error) throw new Error(`Falha ao ler pendências: ${error.message}`);
  return (data || []) as PendingApproval[];
}

export async function getPending(t: TenantDb, pendingId: string): Promise<PendingApproval | null> {
  const { data, error } = await t.select('pending_approvals').eq('pending_id', pendingId).limit(1);
  if (error) throw new Error(`Falha ao ler pendência: ${error.message}`);
  return (data?.[0] as PendingApproval) ?? null;
}

export async function getScheduled(
  t: TenantDb,
  statuses: string[] = ['scheduled', 'publishing', 'failed'],
): Promise<ScheduledPost[]> {
  const { data, error } = await t
    .select('scheduled_posts')
    .in('status', statuses)
    .order('scheduled_for', { ascending: true });
  if (error) throw new Error(`Falha ao ler agendados: ${error.message}`);
  return (data || []) as ScheduledPost[];
}

const HISTORY_COLUMNS = 'id,pillar,angle,channel,hook,body,format,channels,engagement_score,published_at';

export async function getPublishedHistory(t: TenantDb, limit = 50): Promise<PublishedPost[]> {
  const query = (columns: string) => t
    .select('posts', columns)
    .eq('is_dry_run', false)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  let { data, error } = await query(`${HISTORY_COLUMNS},funnel`);
  // Sem a 0010, posts.funnel não existe (42703): mostra o histórico sem o funil.
  if (error?.code === '42703') ({ data, error } = await query(HISTORY_COLUMNS));
  if (error) throw new Error(`Falha ao ler histórico: ${error.message}`);
  return (data || []) as unknown as PublishedPost[]; // select dinâmico: o shape da linha não é inferido
}

export async function getRecentlyPublishedScheduled(t: TenantDb, limit = 30): Promise<ScheduledPost[]> {
  const { data, error } = await t
    .select('scheduled_posts')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Falha ao ler publicados: ${error.message}`);
  return (data || []) as ScheduledPost[];
}

// Campanha ativa hoje (janela inclusiva). Se duas se sobrepõem, vence a de início mais antigo.
export async function getActiveCampaign(
  t: TenantDb,
  today = new Date().toISOString().slice(0, 10),
): Promise<Campaign | null> {
  const { data, error } = await t
    .select('campaigns', 'id,slug,name,start_date,end_date,status')
    .eq('status', 'active')
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('start_date', { ascending: true, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`Falha ao ler campanha ativa: ${error.message}`);
  return (data?.[0] as Campaign) ?? null;
}

export async function getSlots(t: TenantDb): Promise<PublishSlot[]> {
  const { data, error } = await t.select('publish_slots').order('channel').order('weekday').order('hour');
  if (error) throw new Error(`Falha ao ler slots: ${error.message}`);
  return (data || []) as PublishSlot[];
}

export async function countByStatus(t: TenantDb): Promise<{ pendings: number; scheduled: number; failed: number }> {
  const count = (table: string) => t.select(table, 'id', { count: 'exact', head: true });
  const [p, s, f] = await Promise.all([
    count('pending_approvals'),
    count('scheduled_posts').eq('status', 'scheduled'),
    count('scheduled_posts').eq('status', 'failed'),
  ]);
  return { pendings: p.count ?? 0, scheduled: s.count ?? 0, failed: f.count ?? 0 };
}
