// Conta e plano (SPEC 025): o que a tela mostra por tipo de conta e a validação do pedido da Agência e do upgrade. Puro, sem banco.
import { describe, it, expect } from 'vitest';
import { AGENCY_BRANDS_MAX, AGENCY_NOTE_MAX, TIER_COPY, parseAgencyRequest, parsePlanChange, tierOf } from '../platform/src/lib/account-plan-model.ts';

describe('plano da conta', () => {
  it('conta "Só eu" é Individual e empresa é Time', () => {
    expect(tierOf('pessoa')).toBe('individual');
    expect(tierOf('empresa')).toBe('time');
    expect(TIER_COPY.time.summary).toContain('R$ 10');
  });
});

describe('upgrade', () => {
  it('só existe o upgrade para Time', () => {
    expect(parsePlanChange({ to: 'time' })).toEqual({ ok: true, value: { to: 'time' } });
    for (const body of [null, {}, { to: 'agencia' }, { to: 'individual' }, [], 'time']) expect(parsePlanChange(body).ok, JSON.stringify(body)).toBe(false);
  });
});

describe('pedido da Agência', () => {
  it('aceita número ou texto de 1 a 100 e limpa o recado', () => {
    expect(parseAgencyRequest({ brands: 5, note: '  Somos   uma agência\nde Marília ' })).toEqual({ ok: true, value: { brands: 5, note: 'Somos uma agência de Marília' } });
    expect(parseAgencyRequest({ brands: '3' }).value).toEqual({ brands: 3, note: null });
    expect(parseAgencyRequest({ brands: AGENCY_BRANDS_MAX, note: '   ' }).value.note).toBeNull();
  });

  it('recusa quantidade inválida e recado longo, com o campo', () => {
    for (const brands of [0, 101, 2.5, 'x', '', null, undefined]) expect(parseAgencyRequest({ brands }), String(brands)).toMatchObject({ ok: false, field: 'brands' });
    expect(parseAgencyRequest({ brands: 2, note: 'a'.repeat(AGENCY_NOTE_MAX + 1) })).toMatchObject({ ok: false, field: 'note' });
    expect(parseAgencyRequest(null)).toMatchObject({ ok: false, field: 'brands' });
  });
});
