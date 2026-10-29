// pricing.ts: a cotação do dólar em reais, de um arquivo de configuração datado (SPEC 031). Só o console da BEZ usa: o custo nasce em dólar e a
// fatura do cliente é em reais. Sem busca automática: a data de revisão tem teto, como o perfil de sinais das redes.

import data from './pricing.json';

export const MAX_AGE_DAYS = data.max_age_days as number;
export const FX_USD_BRL = data.fx.usd_brl as number;
export const FX_REVIEWED_AT = data.fx.reviewed_at as string;
export const FX_SOURCE = data.fx.source as string;

const DAY = 86_400_000;

export const toBrl = (usd: number, rate: number = FX_USD_BRL): number => usd * rate;

// Quantos dias se passaram desde a revisão da cotação (NaN se a data for inválida).
export function fxAgeDays(now: number = Date.now()): number {
  const reviewed = Date.parse(FX_REVIEWED_AT);
  return Number.isFinite(reviewed) ? Math.floor((now - reviewed) / DAY) : Number.NaN;
}

// A cotação passou do prazo sem revisão? O teste do repositório reprova; o console avisa na tela.
export const fxIsStale = (now: number = Date.now()): boolean => !(fxAgeDays(now) <= MAX_AGE_DAYS);
