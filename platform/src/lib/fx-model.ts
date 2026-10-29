// fx-model.ts: a taxa de câmbio do mês, a parte pura (BEZ-475). O Google Cloud converte o preço em dólar por uma taxa própria, definida no início
// de cada mês e faturada em reais (não é a cotação comercial). A taxa de cada mês fica no banco (`platform_fx_rates`), gravada pelo console a
// partir do `currency_conversion_rate` do export de billing; o arquivo `pricing.json` é só a reserva para quando não há taxa nenhuma.

import { monthKeyOf, type MonthKey } from './usage-model';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonthKey = (value: unknown): value is MonthKey => typeof value === 'string' && MONTH.test(value);

export type FxRate = { month: MonthKey; usdBrl: number };

// De onde veio a taxa usada num mês: a do próprio mês, a de um mês anterior (a última conhecida) ou a do arquivo de reserva.
export type FxResolved = { usdBrl: number; month: MonthKey | null; kind: 'month' | 'carried' | 'file' };

// A taxa de um mês: a dele; sem ela, a do mês mais recente anterior; sem nenhuma, a reserva. Nunca usa a de um mês posterior.
export function resolveFx(rates: readonly FxRate[], month: MonthKey, fileUsdBrl: number): FxResolved {
  const exact = rates.find((r) => r.month === month);
  if (exact) return { usdBrl: exact.usdBrl, month: exact.month, kind: 'month' };
  const before = rates.filter((r) => r.month < month).reduce<FxRate | null>((best, r) => (best === null || r.month > best.month ? r : best), null);
  if (before) return { usdBrl: before.usdBrl, month: before.month, kind: 'carried' };
  return { usdBrl: fileUsdBrl, month: null, kind: 'file' };
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

type Parsed = { ok: true; value: FxRate } | { ok: false; error: string };

// O que o console manda ao cadastrar a taxa de um mês. O mês não pode ser futuro; a taxa em reais por dólar, com vírgula ou ponto.
export function parseFxRate(body: unknown, now: Date): Parsed {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Pedido inválido.' };
  if (!isMonthKey(o.month)) return { ok: false, error: 'Mês: use o formato AAAA-MM.' };
  if (o.month > monthKeyOf(now)) return { ok: false, error: 'Mês: escolha o mês atual ou um anterior.' };
  const raw = typeof o.usdBrl === 'number' ? o.usdBrl : typeof o.usdBrl === 'string' ? Number(o.usdBrl.trim().replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(raw) || raw < 0.5 || raw > 50) return { ok: false, error: 'Taxa: use um valor em reais por dólar, de 0,5 a 50.' };
  return { ok: true, value: { month: o.month, usdBrl: round4(raw) } };
}
