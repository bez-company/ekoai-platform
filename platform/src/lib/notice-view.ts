// notice-view.ts: o que a tela de avisos calcula, sem I/O (SPEC 011 R6.3). Quem vê qual aviso, o
// tom de cada nível, o rótulo do dia e o horário em texto.

import type { Role } from './permissions';
import { fmtTime, tzOffset } from './format';

export type Audience = 'admin' | 'team' | 'all';
export type NoticeLevel = 'info' | 'warning' | 'error';
export type NoticeTone = 'info' | 'warning' | 'danger';

export const AUDIENCES: readonly Audience[] = ['admin', 'team', 'all'];

// O público de cada papel: o administrador lê tudo; o criador, o da equipe e o de todos; o leitor,
// só o que é para todos. É a mesma regra da policy da migration 0022.
export const AUDIENCES_BY_ROLE: Record<Role, readonly Audience[]> = {
  admin: ['admin', 'team', 'all'],
  creator: ['team', 'all'],
  viewer: ['all'],
};

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export const toneOf = (level: string): NoticeTone => (level === 'error' ? 'danger' : level === 'warning' ? 'warning' : 'info');

export type NoticeRow = { id: number; kind: string; level: NoticeLevel; title: string; body: string | null; link: string | null; createdAt: string; unread: boolean };

const dayNumber = (iso: string | number) => Math.floor((new Date(iso).getTime() + tzOffset() * 3_600_000) / 86_400_000);

export type DayLabel = 'Hoje' | 'Ontem' | 'Esta semana' | 'Antes';

export function dayLabel(iso: string, nowMs = Date.now()): DayLabel {
  const diff = dayNumber(nowMs) - dayNumber(iso);
  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return diff < 7 ? 'Esta semana' : 'Antes';
}

const pad = (n: number) => String(n).padStart(2, '0');

// "Hoje, 09:12", "Ontem, 17:05" ou "12/10, 10:22".
export function noticeWhen(iso: string, nowMs = Date.now()): string {
  const label = dayLabel(iso, nowMs);
  if (label === 'Hoje' || label === 'Ontem') return `${label}, ${fmtTime(iso)}`;
  const d = new Date(new Date(iso).getTime() + tzOffset() * 3_600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}, ${fmtTime(iso)}`;
}

export function groupNotices(rows: NoticeRow[], nowMs = Date.now()): { label: DayLabel; items: NoticeRow[] }[] {
  const out: { label: DayLabel; items: NoticeRow[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.createdAt, nowMs);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(row);
    else out.push({ label, items: [row] });
  }
  return out;
}

// "3 avisos novos" no rótulo do sino, para leitor de tela.
export function bellLabel(unread: number): string {
  if (unread <= 0) return 'Avisos';
  return `Avisos, ${unread} ${unread === 1 ? 'novo' : 'novos'}`;
}
