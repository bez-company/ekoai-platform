// notifications.ts: avisos da conta (SPEC 007), gravados em `notifications` e lidos pela tela.
// Substitui o Telegram. Best-effort: aviso que não grava vai para o log e nunca derruba a
// publicação nem o agendamento. Texto puro, sem HTML: quem mostra escapa.

import type { TenantDb } from './tenant-db';
import { log } from './log';
import type { Role } from './permissions';
import { AUDIENCES_BY_ROLE, type Audience, type NoticeRow } from './notice-view';

export type NoticeLevel = 'info' | 'warning' | 'error';

export type Notice = {
  kind: string;
  level?: NoticeLevel;
  title: string;
  body?: string;
  link?: string;
  // Quem recebe: admin (padrão do banco), team (administrador e criador) ou all (todos).
  audience?: Audience;
};

const TITLE_MAX = 200;
const CHANNEL_NAMES: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

export function channelName(channel: string): string {
  return CHANNEL_NAMES[channel] ?? channel;
}

export async function notify(t: TenantDb, n: Notice): Promise<void> {
  const row = {
    kind: n.kind,
    level: n.level ?? 'info',
    title: n.title.slice(0, TITLE_MAX),
    body: n.body ?? null,
    link: n.link?.startsWith('/') ? n.link : null,
    ...(n.audience ? { audience: n.audience } : {}),
  };
  try {
    const { error } = await t.insert('notifications', row);
    if (error) log('warn', 'notifications', 'aviso não gravado', { tenant: t.tenantId, kind: n.kind, error: error.message });
  } catch (e) {
    log('warn', 'notifications', 'aviso não gravado', { tenant: t.tenantId, kind: n.kind, error: e instanceof Error ? e.message : String(e) });
  }
}

type Row = Record<string, unknown>;
const toRow = (r: Row, seenAtMs: number | null): NoticeRow => ({
  id: Number(r.id),
  kind: String(r.kind),
  level: r.level as NoticeRow['level'],
  title: String(r.title),
  body: (r.body as string | null) ?? null,
  link: (r.link as string | null) ?? null,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  unread: seenAtMs !== null && new Date(r.created_at as string).getTime() > seenAtMs,
});

// Até quando esta pessoa já viu os avisos desta conta. Sem pessoa (login de senha única) não há
// leitura por pessoa: nada é "novo".
export async function noticesSeenAt(t: TenantDb, userId: string | null): Promise<number | null> {
  if (!userId) return null;
  const res = await t.select('tenant_members', 'notices_seen_at').eq('user_id', userId).maybeSingle();
  if (res.error) throw new Error(`avisos: ${res.error.message}`);
  return res.data ? new Date(res.data.notices_seen_at as string).getTime() : null;
}

// Os avisos do público deste papel, do mais novo para o mais velho.
export async function listNotices(t: TenantDb, role: Role, userId: string | null, limit = 50): Promise<NoticeRow[]> {
  const seen = await noticesSeenAt(t, userId);
  const res = await t
    .select('notifications', 'id,kind,level,title,body,link,created_at')
    .in('audience', [...AUDIENCES_BY_ROLE[role]])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) throw new Error(`avisos: ${res.error.message}`);
  return (res.data ?? []).map((r) => toRow(r, seen));
}

export async function unreadCount(t: TenantDb, role: Role, userId: string | null): Promise<number> {
  const seen = await noticesSeenAt(t, userId);
  if (seen === null) return 0;
  const res = await t
    .select('notifications', 'id', { count: 'exact', head: true })
    .in('audience', [...AUDIENCES_BY_ROLE[role]])
    .gt('created_at', new Date(seen).toISOString());
  if (res.error) throw new Error(`avisos: ${res.error.message}`);
  return res.count ?? 0;
}

// "Marcar todos como lidos": a pessoa passa a ter visto tudo até agora.
export async function markNoticesSeen(t: TenantDb, userId: string): Promise<void> {
  const res = await t.update('tenant_members', { notices_seen_at: new Date().toISOString() }).eq('user_id', userId);
  if (res.error) throw new Error(`avisos: ${res.error.message}`);
}
