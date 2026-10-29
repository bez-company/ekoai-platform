import { describe, it, expect } from 'vitest';
import { isMonthKey, parseFxRate, resolveFx } from '../platform/src/lib/fx-model.ts';

const RATES = [
  { month: '2026-10', usdBrl: 5.9309 },
  { month: '2026-08', usdBrl: 5.7 },
];

describe('taxa de câmbio do mês (BEZ-475)', () => {
  it('vale a taxa do próprio mês; sem ela, a do mês anterior mais recente; sem nenhuma, a reserva do arquivo', () => {
    expect(resolveFx(RATES, '2026-10', 5)).toEqual({ usdBrl: 5.9309, month: '2026-10', kind: 'month' });
    expect(resolveFx(RATES, '2026-09', 5)).toEqual({ usdBrl: 5.7, month: '2026-08', kind: 'carried' });
    expect(resolveFx(RATES, '2026-11', 5)).toEqual({ usdBrl: 5.9309, month: '2026-10', kind: 'carried' });
    expect(resolveFx(RATES, '2026-07', 5)).toEqual({ usdBrl: 5, month: null, kind: 'file' }); // nunca usa a de um mês posterior
    expect(resolveFx([], '2026-10', 5)).toEqual({ usdBrl: 5, month: null, kind: 'file' });
  });

  it('a ordem das taxas não muda o resultado', () => {
    expect(resolveFx([...RATES].reverse(), '2026-09', 5).month).toBe('2026-08');
  });

  it('o mês é AAAA-MM', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey(202610)).toBe(false);
  });

  it('o formulário aceita vírgula, arredonda em 4 casas, recusa mês futuro e taxa fora da faixa', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    expect(parseFxRate({ month: '2026-10', usdBrl: '5,93094140' }, now)).toEqual({ ok: true, value: { month: '2026-10', usdBrl: 5.9309 } });
    expect(parseFxRate({ month: '2026-09', usdBrl: 5.5 }, now).ok).toBe(true);
    expect(parseFxRate({ month: '2026-11', usdBrl: 5.5 }, now).ok).toBe(false);
    expect(parseFxRate({ month: '2026-10', usdBrl: 0 }, now).ok).toBe(false);
    expect(parseFxRate({ month: '2026-10', usdBrl: 51 }, now).ok).toBe(false);
    expect(parseFxRate({ month: '2026-10', usdBrl: 'abc' }, now).ok).toBe(false);
    expect(parseFxRate({ month: 'outubro', usdBrl: 5.5 }, now).ok).toBe(false);
    expect(parseFxRate(null, now).ok).toBe(false);
  });
});
