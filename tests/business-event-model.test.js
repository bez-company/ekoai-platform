// Resultados com origem (SPEC 038, BEZ-551): o que o registro aceita e como o resumo separa as origens.
import { describe, it, expect } from 'vitest';
import { parseBrl, parseBusinessEvent, summarizeByOrigin } from '../platform/src/lib/business-event-model.ts';

const TODAY = '2026-11-04';
const ok = { kind: 'order', occurred_on: '2026-11-02', value_brl: '89,90', origin: 'declared' };

describe('parseBusinessEvent', () => {
  it('pedido com valor, origem, post e observação', () => {
    const post = '7d3f0c1e-2b4a-4c5d-8e9f-0a1b2c3d4e5f';
    expect(parseBusinessEvent({ ...ok, post_id: post, note: ' Encomenda da ceia ' }, TODAY)).toEqual({ ok: true, value: { kind: 'order', occurred_on: '2026-11-02', value_brl: 89.9, origin: 'declared', campaign_id: null, post_id: post, note: 'Encomenda da ceia' } });
  });

  it('origem é obrigatória e sem padrão', () => {
    expect(parseBusinessEvent({ ...ok, origin: undefined }, TODAY)).toMatchObject({ ok: false, field: 'origin' });
    expect(parseBusinessEvent({ ...ok, origin: 'instagram' }, TODAY)).toMatchObject({ ok: false, field: 'origin' });
  });

  it('data no futuro ou de mais de um ano atrás é recusada', () => {
    expect(parseBusinessEvent({ ...ok, occurred_on: '2026-11-05' }, TODAY)).toMatchObject({ ok: false, field: 'occurred_on' });
    expect(parseBusinessEvent({ ...ok, occurred_on: '2025-10-01' }, TODAY)).toMatchObject({ ok: false, field: 'occurred_on' });
    expect(parseBusinessEvent({ ...ok, occurred_on: '04/11/2026' }, TODAY)).toMatchObject({ ok: false, field: 'occurred_on' });
  });

  it('contato não tem valor; valor inválido ou fora do limite é recusado', () => {
    expect(parseBusinessEvent({ ...ok, kind: 'contact', value_brl: '' }, TODAY)).toMatchObject({ ok: true, value: { value_brl: null } });
    expect(parseBusinessEvent({ ...ok, kind: 'contact', value_brl: '10' }, TODAY)).toMatchObject({ ok: false, field: 'value_brl' });
    expect(parseBusinessEvent({ ...ok, value_brl: 'muito' }, TODAY)).toMatchObject({ ok: false, field: 'value_brl' });
    expect(parseBusinessEvent({ ...ok, value_brl: 20_000_000 }, TODAY)).toMatchObject({ ok: false, field: 'value_brl' });
  });

  it('observação sem e-mail nem telefone do cliente', () => {
    expect(parseBusinessEvent({ ...ok, note: 'cliente: maria@exemplo.com' }, TODAY)).toMatchObject({ ok: false, field: 'note' });
    expect(parseBusinessEvent({ ...ok, note: 'ligar (14) 99876-5432' }, TODAY)).toMatchObject({ ok: false, field: 'note' });
    expect(parseBusinessEvent({ ...ok, note: 'x'.repeat(201) }, TODAY)).toMatchObject({ ok: false, field: 'note' });
    expect(parseBusinessEvent({ ...ok, note: 'Encomenda de 2 caixas' }, TODAY).ok).toBe(true);
  });
});

describe('parseBrl', () => {
  it('aceita número e texto em reais', () => {
    expect(parseBrl('R$ 1.234,56')).toBe(1234.56);
    expect(parseBrl('89')).toBe(89);
    expect(parseBrl(178)).toBe(178);
    expect(parseBrl('')).toBeNull();
    expect(parseBrl('1,234')).toBeUndefined();
  });
});

describe('summarizeByOrigin', () => {
  it('sempre as três origens, separadas, com o que cada uma reúne', () => {
    const s = summarizeByOrigin([
      { kind: 'sale', origin: 'declared', valueBrl: 178 },
      { kind: 'order', origin: 'observed', valueBrl: 89 },
      { kind: 'quote', origin: 'declared', valueBrl: 620 },
      { kind: 'contact', origin: 'unknown', valueBrl: null },
    ]);
    expect(s.map((x) => [x.label, x.count, x.detail])).toEqual([
      ['Pelo link', 1, '1 pedido, R$ 89'],
      ['Cliente disse', 2, '1 orçamento e 1 venda, R$ 798'],
      ['Não sei', 1, '1 contato'],
    ]);
  });

  it('sem registro: as três com zero', () => {
    expect(summarizeByOrigin([]).map((x) => [x.count, x.detail])).toEqual([[0, 'nada registrado'], [0, 'nada registrado'], [0, 'nada registrado']]);
  });
});
