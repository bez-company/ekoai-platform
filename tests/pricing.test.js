import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FX_REVIEWED_AT, FX_USD_BRL, MAX_AGE_DAYS, fxAgeDays, fxIsStale, toBrl } from '../platform/src/lib/pricing.ts';

const DAY = 86_400_000;
const reviewed = Date.parse(FX_REVIEWED_AT);

describe('cotação do dólar do Console › Financeiro (SPEC 031)', () => {
  it('a cotação tem valor positivo e data válida', () => {
    expect(FX_USD_BRL).toBeGreaterThan(0);
    expect(Number.isFinite(reviewed)).toBe(true);
  });

  it('a cotação não passa do prazo sem revisão: troque `usd_brl` e `reviewed_at` em platform/src/lib/pricing.json', () => {
    expect(fxIsStale(), `pricing.json foi revisado em ${FX_REVIEWED_AT} (mais de ${MAX_AGE_DAYS} dias)`).toBe(false);
  });

  it('a conta de dias e o prazo funcionam', () => {
    expect(fxAgeDays(reviewed + 10 * DAY)).toBe(10);
    expect(fxIsStale(reviewed + MAX_AGE_DAYS * DAY)).toBe(false);
    expect(fxIsStale(reviewed + (MAX_AGE_DAYS + 1) * DAY)).toBe(true);
  });

  it('converte dólar em real pela cotação, ou por uma cotação dada', () => {
    expect(toBrl(2)).toBeCloseTo(2 * FX_USD_BRL, 6);
    expect(toBrl(2, 5)).toBe(10);
    expect(toBrl(0)).toBe(0);
  });

  it('o arquivo explica de onde vem o número e não usa travessão', () => {
    const raw = readFileSync(new URL('../platform/src/lib/pricing.json', import.meta.url), 'utf8');
    expect(JSON.parse(raw)._doc).toContain('currency_conversion_rate');
    expect(raw).not.toMatch(/[–—]/);
  });
});
