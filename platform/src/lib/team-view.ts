// team-view.ts: o que a tela de equipe mostra, calculado sem I/O (SPEC 011 R4). A regra de vagas
// é a do gatilho do banco (migration 0018): membros mais convites pendentes e não vencidos.

import type { Role } from './permissions';
import type { InviteStatus } from './invitation-model';

export type SeatUsage = { used: number; max: number; free: number; full: boolean; unlimited: boolean; label: string };

// O teto da coluna `plans.max_seats` (migration 0051): plano com esse valor não limita a equipe.
export const UNLIMITED_SEATS = 1000;

export const seatLimitLabel = (used: number, maxSeats: number): string =>
  maxSeats >= UNLIMITED_SEATS ? `${used} (sem limite)` : `${used} de ${maxSeats}`;

export function seatUsage(input: { members: number; invitations: { status: InviteStatus }[]; maxSeats: number }): SeatUsage {
  const pending = input.invitations.filter((i) => i.status === 'pending').length;
  const used = input.members + pending;
  const unlimited = input.maxSeats >= UNLIMITED_SEATS;
  const free = Math.max(0, input.maxSeats - used);
  const unit = used === 1 || (!unlimited && input.maxSeats === 1) ? 'pessoa' : 'pessoas';
  return { used, max: input.maxSeats, free, full: !unlimited && used >= input.maxSeats, unlimited, label: unlimited ? `${used} ${unit}` : `${used} de ${input.maxSeats} ${unit}` };
}

// "Ana Souza" vira "AS"; sem nome, a primeira letra do e-mail.
export function initials(name: string | null, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email[0] ?? '?').toUpperCase();
}

// Quantos administradores a conta tem: a tela avisa antes de o banco recusar o último.
export function adminCount(members: { role: Role }[]): number {
  return members.filter((m) => m.role === 'admin').length;
}

// Texto da validade do convite: "Vence em 5 dias" ou "Venceu".
export function inviteExpiry(status: InviteStatus, daysLeft: number): string {
  if (status === 'expired') return 'Venceu';
  if (daysLeft <= 1) return 'Vence em 1 dia';
  return `Vence em ${daysLeft} dias`;
}

const BRASILIA = 'America/Sao_Paulo';
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: BRASILIA });
const DAY = 86_400_000;

// "Último acesso hoje", "ontem", "há 3 dias" ou a data. Os dias contam no horário de Brasília, não em UTC.
export function lastAccessLabel(lastLoginAt: string | null, nowMs: number): string {
  if (!lastLoginAt) return 'Ainda não entrou';
  const at = Date.parse(lastLoginAt);
  if (!Number.isFinite(at)) return 'Ainda não entrou';
  const days = Math.round((Date.parse(`${dayKey(nowMs)}T00:00:00Z`) - Date.parse(`${dayKey(at)}T00:00:00Z`)) / DAY);
  if (days <= 0) return 'Último acesso hoje';
  if (days === 1) return 'Último acesso ontem';
  if (days < 7) return `Último acesso há ${days} dias`;
  return `Último acesso em ${new Date(at).toLocaleDateString('pt-BR', { timeZone: BRASILIA })}`;
}

// A pessoa é a única administradora: o menu dela explica por que mudar o papel e sair estão desligados (o banco também recusa).
export function isSoleAdmin(members: { userId: string; role: Role }[], userId: string): boolean {
  const admins = members.filter((m) => m.role === 'admin');
  return admins.length === 1 && admins[0].userId === userId;
}
