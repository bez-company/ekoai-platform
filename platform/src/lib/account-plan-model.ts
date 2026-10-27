// account-plan-model.ts: Conta e plano (SPEC 025, BEZ-376). Puro, sem I/O: como a conta aparece (Individual, Time) e o corpo do
// pedido de contato da Agência. O preço e as regras de cobrança são da SPEC 021; aqui só o que a tela mostra e valida.

import type { AccountKind } from './account-model';

export type PlanTier = 'individual' | 'time';

// Conta "Só eu" é Individual; Empresa é Time (o plano `inicial` do banco, 5 pessoas, até a cobrança real existir).
export const tierOf = (kind: AccountKind): PlanTier => (kind === 'pessoa' ? 'individual' : 'time');

export const TIER_COPY: Record<PlanTier, { title: string; summary: string }> = {
  individual: { title: 'Plano Individual', summary: 'Uma pessoa, um perfil. Você paga só pelos posts.' },
  time: { title: 'Plano Time', summary: 'Quem cria e quem aprova. O primeiro usuário é grátis e cada usuário adicional custa R$ 10 por mês.' },
};

export const AGENCY_BRANDS_MAX = 100;
export const AGENCY_NOTE_MAX = 500;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

// Pedido de contato da Agência: quantas marcas e, se quiser, um recado. Nada é cobrado.
export function parseAgencyRequest(body: unknown): Parsed<{ brands: number; note: string | null }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const n = typeof b.brands === 'number' ? b.brands : Number(typeof b.brands === 'string' ? b.brands.trim() : NaN);
  if (!Number.isInteger(n) || n < 1 || n > AGENCY_BRANDS_MAX) return { ok: false, error: `Diga quantas marcas, de 1 a ${AGENCY_BRANDS_MAX}.`, field: 'brands' };
  const raw = typeof b.note === 'string' ? b.note.replace(/\s+/g, ' ').trim() : '';
  if (raw.length > AGENCY_NOTE_MAX) return { ok: false, error: `O recado pode ter até ${AGENCY_NOTE_MAX} caracteres.`, field: 'note' };
  return { ok: true, value: { brands: n, note: raw || null } };
}

// O corpo de POST /api/account/plan: só existe o upgrade para Time.
export function parsePlanChange(body: unknown): Parsed<{ to: 'time' }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return b.to === 'time' ? { ok: true, value: { to: 'time' } } : { ok: false, error: 'Escolha o plano Time.' };
}
