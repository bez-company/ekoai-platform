// account-deletion-model.ts: as regras de excluir uma conta, sem I/O (SPEC 011 R8). A exclusão é
// definitiva, então exige duas provas além da sessão: o NOME da conta digitado e uma reautenticação
// RECENTE (um ID token novo, com a senha e, com MFA_MODE=required, o código do app).

import { isIdTokenShape } from './route-input';
import { mfaMode, type MfaMode } from './login-policy';
import type { Identity } from './identity';

// Quanto tempo vale a reautenticação: a pessoa acabou de confirmar com o código do app.
export const REAUTH_MAX_AGE_S = 5 * 60;

export type DeleteBody = { confirmName: string; idToken: string };
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Nome conferido por igualdade exata, só sem os espaços das pontas e repetidos (o que o campo de
// texto costuma bagunçar). Maiúscula e acento valem: é uma ação sem volta.
export function normalizeName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function confirmationMatches(typed: string, accountName: string): boolean {
  const expected = normalizeName(accountName);
  return expected.length > 0 && normalizeName(typed) === expected;
}

export function parseDeleteBody(body: unknown): Parsed<DeleteBody> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const confirmName = typeof b.confirmName === 'string' ? b.confirmName : '';
  if (!confirmName.trim() || confirmName.length > 200) return { ok: false, error: 'Digite o nome da conta para confirmar.' };
  if (!isIdTokenShape(b.idToken)) return { ok: false, error: 'Confirme com a sua senha e o código do app autenticador.' };
  return { ok: true, value: { confirmName, idToken: b.idToken } };
}

export type ReauthRefusal = 'wrong_person' | 'email_not_verified' | 'no_second_factor' | 'stale';

export const REAUTH_MESSAGES: Record<ReauthRefusal, string> = {
  wrong_person: 'Entre com a mesma conta que está aberta aqui para confirmar a exclusão.',
  email_not_verified: 'Confirme o e-mail da conta antes de excluir.',
  no_second_factor: 'A exclusão pede o código do app autenticador. Ative a verificação em duas etapas e tente de novo.',
  stale: 'A confirmação venceu. Digite a senha e o código do app de novo.',
};

// O ID token de uma reautenticação: é da mesma pessoa da sessão, trouxe o segundo fator (só se o
// MFA for obrigatório) e a autenticação (auth_time) é de poucos minutos atrás. Token antigo com o
// claim do login não serve.
export function reauthRefusal(identity: Identity, expectedUid: string | null, nowMs = Date.now(), mode: MfaMode = mfaMode()): ReauthRefusal | null {
  if (!expectedUid || identity.uid !== expectedUid) return 'wrong_person';
  if (!identity.emailVerified) return 'email_not_verified';
  if (mode === 'required' && !identity.secondFactor) return 'no_second_factor';
  if (nowMs / 1000 - identity.authTime > REAUTH_MAX_AGE_S || identity.authTime > nowMs / 1000 + 60) return 'stale';
  return null;
}

// Ordem de apagar as tabelas da conta: quem aponta (filho) antes de quem é apontado (pai). `edges`
// são pares [filho, pai] entre as tabelas da lista (de pg_constraint). Autorreferência não conta.
// Ciclo é erro: a exclusão não tenta adivinhar.
export function deletionOrder(tables: readonly string[], edges: readonly (readonly [string, string])[]): string[] {
  const set = new Set(tables);
  const parentsOf = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  const childrenOf = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  for (const [child, parent] of edges) {
    if (child === parent || !set.has(child) || !set.has(parent)) continue;
    parentsOf.get(child)!.add(parent);
    childrenOf.get(parent)!.add(child);
  }
  // Um pai só sai depois de todos os filhos: conta os filhos que faltam apagar.
  const pending = new Map<string, number>(tables.map((t) => [t, childrenOf.get(t)!.size]));
  const ready = tables.filter((t) => pending.get(t) === 0).sort();
  const out: string[] = [];
  while (ready.length) {
    const t = ready.shift()!;
    out.push(t);
    for (const parent of [...parentsOf.get(t)!].sort()) {
      pending.set(parent, pending.get(parent)! - 1);
      if (pending.get(parent) === 0) ready.push(parent);
    }
  }
  if (out.length !== tables.length) throw new Error('as tabelas da conta têm um ciclo de chaves estrangeiras; a exclusão não sabe a ordem');
  return out;
}
