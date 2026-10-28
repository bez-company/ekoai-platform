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
