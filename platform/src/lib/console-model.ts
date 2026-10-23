// console-model.ts: o que o console do administrador da plataforma aceita e mostra (BEZ-303, SPEC 011
// R9). Puro, sem I/O: parsers do corpo das rotas, o filtro da lista e o status de uma conta.

import { NAME_MAX, isAccountKind, type AccountKind } from './account-model';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

// ─── status ──────────────────────────────────────────────────────────────────

export type AccountStatus = 'active' | 'paused' | 'suspended';

export const STATUS_LABEL: Record<AccountStatus, string> = { active: 'Ativa', paused: 'Pausada', suspended: 'Suspensa' };

// Suspensa vale mais que pausada: é o estado que o console controla e que tranca o acesso.
export function accountStatus(row: { status: string; paused: boolean }): AccountStatus {
  if (row.status === 'suspended') return 'suspended';
  return row.paused ? 'paused' : 'active';
}

// ─── lista: busca e filtro pela URL ──────────────────────────────────────────

export type StatusFilter = 'all' | AccountStatus;
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Ativas' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'suspended', label: 'Suspensas' },
];

export const SEARCH_MAX = 80;

export type AccountQuery = { search: string; status: StatusFilter };

// Valor desconhecido na URL volta ao padrão (Todas, sem busca): a lista nunca quebra por um link velho.
export function parseAccountQuery(params: { q?: unknown; status?: unknown }): AccountQuery {
  const q = typeof params.q === 'string' ? params.q.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX) : '';
  const status = STATUS_FILTERS.find((f) => f.value === params.status)?.value ?? 'all';
  return { search: q, status };
}

// ─── criar conta ─────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreateConsoleAccount = { name: string; kind: AccountKind; email: string };

export function parseCreateConsoleAccount(body: unknown): Parsed<CreateConsoleAccount> {
  const b = obj(body);
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { ok: false, error: 'Dê um nome para a conta.' };
  if (name.length > NAME_MAX) return { ok: false, error: `O nome da conta pode ter até ${NAME_MAX} caracteres.` };
  if (!isAccountKind(b.kind)) return { ok: false, error: 'Escolha se a conta é de uma empresa ou de uma pessoa.' };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, error: 'Digite o e-mail completo do primeiro administrador, como ana@empresa.com.br.' };
  }
  return { ok: true, value: { name, kind: b.kind, email } };
}

export const KIND_LABEL: Record<AccountKind, string> = { empresa: 'Empresa', pessoa: 'Pessoa' };

// ─── suspender ───────────────────────────────────────────────────────────────

export const REASON_MIN = 5;
export const REASON_MAX = 500;

// O motivo é obrigatório: vai para o registro de auditoria e fica visível no console.
export function parseSuspend(body: unknown): Parsed<{ reason: string }> {
  const raw = obj(body).reason;
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (reason.length < REASON_MIN) return { ok: false, error: 'Conte o motivo da suspensão em uma frase. Ele vai para o registro de auditoria.' };
  if (reason.length > REASON_MAX) return { ok: false, error: `O motivo pode ter até ${REASON_MAX} caracteres.` };
  return { ok: true, value: { reason } };
}

// O identificador de conta que as rotas aceitam no caminho.
export function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(value);
}
