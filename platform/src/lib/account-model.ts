// account-model.ts: cadastro e criação de conta (SPEC 011 R2). Puro, sem I/O: o que passa daqui já
// tem o tipo certo e as regras de quem pode criar conta estão num lugar só, testável sem banco
// nem Firebase.

import type { Identity } from './identity';
import { identityRefusal, type LoginRefusal } from './login-policy';
import { isIdTokenShape } from './route-input';

export type AccountKind = 'empresa' | 'pessoa';

export const ACCOUNT_KINDS: readonly AccountKind[] = ['empresa', 'pessoa'];

// Plano inicial de cada tipo (migration 0017): o gatilho do banco exige plano do mesmo tipo.
export const PLAN_BY_KIND: Record<AccountKind, string> = { empresa: 'inicial', pessoa: 'pessoa' };

export const NAME_MAX = 80;

// Quantas contas uma pessoa administra antes de a plataforma pedir contato. Freio simples contra
// abuso enquanto não há limite de taxa; quem precisa de mais fala com a gente.
export const MAX_ADMIN_ACCOUNTS = 5;

export type SignupMode = 'invite' | 'open';

// Padrão: só por convite. Qualquer valor desconhecido também fecha (falha segura).
export function signupMode(env: Record<string, string | undefined> = process.env): SignupMode {
  return env.SIGNUP_MODE === 'open' ? 'open' : 'invite';
}

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

// Nome da conta -> identificador da tabela tenants (`^[a-z0-9][a-z0-9-]{1,39}$`): sem acento, em
// minúsculas, hífen no lugar do resto. Nome só com símbolo cai em "conta".
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'conta';
}

// Identificadores a tentar, do mais bonito ao mais único: o slug puro e depois com sufixo
// aleatório. `rand` entra por parâmetro para o teste ser determinístico.
export function candidateIds(name: string, rand: () => string = randomSuffix): string[] {
  const base = slugify(name);
  return [base, `${base}-${rand()}`, `${base}-${rand()}`, `${base}-${rand()}`, `${base}-${rand()}`];
}

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 4);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type CreateAccountBody = { idToken: string; kind: AccountKind; name: string };

export function parseCreateAccount(body: unknown): Parsed<CreateAccountBody> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!isIdTokenShape(b.idToken)) {
    return { ok: false, error: 'Login inválido. Entre de novo.' };
  }
  if (!isAccountKind(b.kind)) return { ok: false, error: 'Escolha se a conta é de uma empresa ou só sua.' };
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { ok: false, error: 'Dê um nome para a conta.' };
  if (name.length > NAME_MAX) return { ok: false, error: `O nome da conta pode ter até ${NAME_MAX} caracteres.` };
  return { ok: true, value: { idToken: b.idToken, kind: b.kind, name } };
}

const REFUSALS = {
  mfa: {
    status: 403,
    code: 'mfa_required',
    error: 'Quem cria a conta vira administrador e entra com verificação em duas etapas. Ative o app autenticador e tente de novo.',
  },
  tooMany: {
    status: 403,
    code: 'account_limit',
    error: `Você já administra ${MAX_ADMIN_ACCOUNTS} contas. Para criar outra, fale com o suporte.`,
  },
} satisfies Record<string, LoginRefusal>;

// Antes de tocar no banco: e-mail verificado, login recente e segundo fator (quem cria é admin).
export function accountRefusal(id: Identity, nowS: number): LoginRefusal | null {
  const early = identityRefusal(id, nowS);
  if (early) return early;
  return id.secondFactor ? null : REFUSALS.mfa;
}

export function adminAccountLimitRefusal(adminAccounts: number): LoginRefusal | null {
  return adminAccounts >= MAX_ADMIN_ACCOUNTS ? REFUSALS.tooMany : null;
}
