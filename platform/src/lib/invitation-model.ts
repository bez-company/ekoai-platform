// invitation-model.ts: convites e equipe (SPEC 011 R4). Puro, sem I/O. O token do convite nasce
// aqui, vai inteiro só no link e o banco guarda apenas o hash (migration 0018).

import { isRole, type Role } from './permissions';

export const INVITE_TTL_DAYS = 7;

export type InviteStatus = 'pending' | 'expired' | 'accepted' | 'cancelled';

type InviteDates = { accepted_at?: string | null; cancelled_at?: string | null; expires_at: string };

// Cancelado e aceito valem mais que vencido: é o que a pessoa precisa ler na tela.
export function inviteStatus(row: InviteDates, nowMs = Date.now()): InviteStatus {
  if (row.cancelled_at) return 'cancelled';
  if (row.accepted_at) return 'accepted';
  return new Date(row.expires_at).getTime() <= nowMs ? 'expired' : 'pending';
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

// 32 bytes aleatórios em base64url (43 caracteres): adivinhar é inviável.
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/convite/${token}`;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export function parseCreateInvitation(body: unknown): Parsed<{ email: string; role: Role }> {
  const b = obj(body);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, error: 'Digite um e-mail completo, como ana@empresa.com.br.' };
  }
  if (!isRole(b.role)) return { ok: false, error: 'Escolha o papel da pessoa: administrador, criador ou leitor.' };
  return { ok: true, value: { email, role: b.role } };
}

export function parseRoleChange(body: unknown): Parsed<{ role: Role }> {
  const role = obj(body).role;
  if (!isRole(role)) return { ok: false, error: 'Escolha o papel da pessoa: administrador, criador ou leitor.' };
  return { ok: true, value: { role } };
}

export function parseAcceptInvitation(body: unknown): Parsed<{ idToken: string; token: string }> {
  const b = obj(body);
  if (typeof b.idToken !== 'string' || b.idToken.length > 8192 || !JWT.test(b.idToken)) {
    return { ok: false, error: 'Login inválido. Entre de novo.' };
  }
  if (!isInviteToken(b.token)) return { ok: false, error: 'O link do convite está incompleto. Abra o link do e-mail de novo.' };
  return { ok: true, value: { idToken: b.idToken, token: b.token } };
}

export type InviteRefusal = { status: 403 | 404 | 409 | 410; code: string; error: string };

// Mensagens fixas de app.accept_invitation() (migration 0018) viram resposta para a tela.
const FAILURES: Record<string, InviteRefusal> = {
  invitation_not_found: { status: 404, code: 'invite_not_found', error: 'Não achamos este convite. Confira o link ou peça um novo.' },
  invitation_cancelled: { status: 410, code: 'invite_cancelled', error: 'Este convite foi cancelado. Se achar que é engano, fale com quem administra a conta.' },
  invitation_used: { status: 410, code: 'invite_used', error: 'Este convite já foi usado. Se foi você, entre com o seu e-mail.' },
  invitation_expired: { status: 410, code: 'invite_expired', error: 'Este convite venceu. Peça um novo a quem convidou você.' },
  invitation_email_mismatch: { status: 403, code: 'invite_email_mismatch', error: 'Este convite é para outro e-mail. Saia e entre com o e-mail que recebeu o convite.' },
  already_member: { status: 409, code: 'already_member', error: 'Você já faz parte desta conta.' },
};

export function acceptFailure(message: string): InviteRefusal | null {
  return FAILURES[message] ?? null;
}
