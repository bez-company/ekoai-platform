import { describe, it, expect } from 'vitest';
import { MONTHS_SHOWN, emptyUsage, isEmptyUsage, monthKeyOf, monthLabel, monthRange, parseMonth, recentMonths, totalPublications } from '../platform/src/lib/usage-model.ts';

const NOW = new Date('2026-10-29T12:00:00Z');

describe('uso do mês (SPEC 031, BEZ-456)', () => {
  it('lista os 12 meses do mais novo ao mais antigo, passando pela virada do ano', () => {
    const months = recentMonths(NOW);
    expect(months).toHaveLength(MONTHS_SHOWN);
    expect(months[0]).toBe('2026-10');
    expect(months[9]).toBe('2026-01');
    expect(months[10]).toBe('2025-12');
    expect(months[11]).toBe('2025-11');
    expect(recentMonths(new Date('2027-01-05T00:00:00Z'), 2)).toEqual(['2027-01', '2026-12']);
  });

  it('o mês da URL vale só se for um dos 12 mostrados; o resto volta ao mês atual sem erro', () => {
    expect(parseMonth('2026-09', NOW)).toBe('2026-09');
    expect(parseMonth('2025-11', NOW)).toBe('2025-11');
    for (const bad of ['2025-10', '2026-11', '2026-13', '2026-9', 'outubro', '', null, undefined, 42, ['2026-09']]) expect(parseMonth(bad, NOW)).toBe('2026-10');
    expect(parseMonth(' 2026-08 ', NOW)).toBe('2026-08');
  });

  it('o intervalo do mês é [início, fim) em UTC, inclusive dezembro e fevereiro de ano bissexto', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' });
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' });
    expect(monthRange('2028-02').end).toBe('2028-03-01T00:00:00.000Z');
    expect(() => monthRange('2026-00')).toThrow();
    expect(monthKeyOf(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(monthKeyOf(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });

  it('o nome do mês fica em português, com a primeira letra maiúscula', () => {
    expect(monthLabel('2026-03')).toBe('Março de 2026');
    expect(monthLabel('2026-10')).toBe('Outubro de 2026');
    expect(monthLabel('lixo')).toBe('lixo');
  });

  it('mês vazio é o que não tem post, publicação, imagem nem ajuste; pessoas não contam', () => {
    const u = emptyUsage('2026-10', NOW);
    expect(u.isCurrent).toBe(true);
    expect(isEmptyUsage({ ...u, people: 4 })).toBe(true);
    expect(isEmptyUsage({ ...u, posts: 1 })).toBe(false);
    expect(isEmptyUsage({ ...u, publications: { instagram: 0, linkedin: 0, twitter: 1 } })).toBe(false);
    expect(isEmptyUsage({ ...u, adjustments: 2 })).toBe(false);
    expect(totalPublications({ ...u, publications: { instagram: 16, linkedin: 9, twitter: 6 } })).toBe(31);
    expect(emptyUsage('2026-09', NOW).isCurrent).toBe(false);
  });
});
