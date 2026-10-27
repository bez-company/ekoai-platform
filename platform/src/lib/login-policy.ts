// login-policy.ts: regras para aceitar um login (SPEC 009). Puro, sem I/O, para o teste cobrir
// cada recusa sem precisar do Firebase nem do banco.

import type { Identity } from './identity';
import type { Role } from './permissions';

export const MAX_LOGIN_AGE_S = 5 * 60;

// `optional` (padrão, decisão de 27/10/2026): o segundo fator não é exigido em lugar nenhum; quem
// ativou o app autenticador em Perfil continua recebendo o desafio no login (o Identity Platform
// decide, não esta regra). `required`: administrador entra, cria conta e exclui conta só com segundo
// fator; só vale quando o ambiente pede por MFA_MODE=required.
export type MfaMode = 'required' | 'optional';

export function mfaMode(env: Record<string, string | undefined> = process.env): MfaMode {
  return env.MFA_MODE === 'required' ? 'required' : 'optional';
}

export type LoginRefusal = { status: 401 | 403; code: string; error: string };

// `suspended`: a conta foi suspensa no console (BEZ-303). Quem só tem contas assim não entra.
export type Membership = { tenantId: string; role: Role; createdAt: string; suspended?: boolean };

const REFUSALS = {
  stale: { status: 401, code: 'login_stale', error: 'O login expirou antes de terminar. Entre de novo.' },
  noEmail: { status: 403, code: 'email_missing', error: 'Sua conta de login não tem e-mail. Entre com e-mail e senha ou link.' },
  unverified: { status: 403, code: 'email_not_verified', error: 'Confirme seu e-mail pelo link que enviamos e entre de novo.' },
  noAccess: { status: 403, code: 'no_access', error: 'Seu acesso ainda não foi liberado. Peça um convite ao administrador da conta.' },
  mfa: { status: 403, code: 'mfa_required', error: 'Administradores entram com verificação em duas etapas. Ative o app autenticador e entre de novo.' },
  suspended: { status: 403, code: 'account_suspended', error: 'Esta conta está suspensa. Fale com o suporte da Ekoai para reativar.' },
  notMember: { status: 403, code: 'not_member', error: 'Você não faz parte dessa conta. Escolha outra ou peça um convite.' },
} satisfies Record<string, LoginRefusal>;

// Antes de tocar no banco: e-mail presente e verificado, login recente.
export function identityRefusal(id: Identity, nowS: number): LoginRefusal | null {
  if (!(id.authTime > 0) || nowS - id.authTime > MAX_LOGIN_AGE_S) return REFUSALS.stale;
  if (!id.email) return REFUSALS.noEmail;
  if (!id.emailVerified) return REFUSALS.unverified;
  return null;
}

// Depois de achar as contas: precisa ter alguma, e administrador entra com segundo fator.
export function membershipRefusal(id: Identity, memberships: Membership[], mode: MfaMode = mfaMode()): LoginRefusal | null {
  if (memberships.length === 0) return REFUSALS.noAccess;
  if (mode === 'required' && memberships.some((m) => m.role === 'admin') && !id.secondFactor) return REFUSALS.mfa;
  return null;
}

// Todas as contas da pessoa estão suspensas: a mensagem diz isso em vez de "sem acesso".
export function suspensionRefusal(memberships: Membership[]): LoginRefusal | null {
  return memberships.length > 0 && memberships.every((m) => m.suspended) ? REFUSALS.suspended : null;
}

// Contas em que a pessoa pode entrar: as suspensas ficam de fora.
export const activeMemberships = (memberships: Membership[]): Membership[] => memberships.filter((m) => !m.suspended);

// Conta pedida, senão a última usada, senão a mais antiga. Pedida e não membro = recusa.
export function pickTenant(
  memberships: Membership[],
  requested: string | undefined,
  lastTenantId: string | null,
): { tenantId: string; role: Role } | LoginRefusal {
  if (requested) {
    const m = memberships.find((x) => x.tenantId === requested);
    return m ? { tenantId: m.tenantId, role: m.role } : REFUSALS.notMember;
  }
  const last = lastTenantId ? memberships.find((x) => x.tenantId === lastTenantId) : undefined;
  const pick = last ?? [...memberships].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return pick ? { tenantId: pick.tenantId, role: pick.role } : REFUSALS.noAccess;
}

export function isRefusal(v: unknown): v is LoginRefusal {
  return !!v && typeof v === 'object' && 'code' in v && 'status' in v;
}
