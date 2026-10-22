// Tela Publicados (SPEC 017, decisão 14, BEZ-238): título, média de engajamento e números como o
// Instagram mostra.
import { describe, it, expect } from 'vitest';
import { titleOf, averageEngagement, fmtCount, fmtRate } from '../platform/src/lib/published-feed.ts';

describe('publicados', () => {
  it('o título é o gancho; sem gancho, a primeira linha da legenda, cortada', () => {
    expect(titleOf('Como guardar o bolo', 'Legenda')).toBe('Como guardar o bolo');
    expect(titleOf(null, 'Bolo de pote toda sexta\n\n#doceponto')).toBe('Bolo de pote toda sexta');
    expect(titleOf('  ', '')).toBe('Post sem título');
    expect(titleOf(null, 'x'.repeat(100))).toHaveLength(80);
  });

  it('a média do engajamento ignora post sem leitura', () => {
    expect(averageEngagement([{ metrics: { engagement: 0.1 } }, { metrics: { engagement: 0.05 } }, { metrics: null }])).toBeCloseTo(0.075);
    expect(averageEngagement([{ metrics: null }, { metrics: { engagement: null } }])).toBeNull();
  });

  it('números e taxa em português, com "sem dado" quando falta', () => {
    expect(fmtCount(182)).toBe('182');
    expect(fmtCount(2400)).toBe('2.400');
    expect(fmtCount(12400)).toBe('12,4\u00a0mil'); // espaço que não quebra, como o Intl escreve
    expect(fmtCount(null)).toBe('sem dado');
    expect(fmtRate(0.0962)).toBe('9,6%');
    expect(fmtRate(undefined)).toBe('sem dado');
  });
});
