// Regras com escopo e versão (SPEC 037, BEZ-547): onde cada regra vale e como a tela a mostra.
import { describe, it, expect } from 'vitest';
import { changeOf, ruleCampaigns, ruleScope, rulesFor } from '../platform/src/lib/rule-scope.ts';
import { parseRestore, parseRuleInput } from '../platform/src/lib/learning.ts';

const TODAY = '2026-11-04';
const C = '7d3f0c1e-2b4a-4c5d-8e9f-0a1b2c3d4e5f';
const campaign = (extra = {}) => ({ id: C, name: 'Encomendas de fim de ano', status: 'active', confirmedAt: '2026-10-12T00:00:00Z', startDate: '2026-10-12', endDate: '2026-12-15', ...extra });
const rules = [
  { rule: 'Fechar com CTA para o WhatsApp', active: true, campaign_id: null },
  { rule: 'Evitar "imperdível"', active: false, campaign_id: null },
  { rule: 'Tom festivo, contagem regressiva', active: true, campaign_id: C },
  { rule: 'Regra de outra campanha', active: true, campaign_id: '11111111-1111-4111-8111-111111111111' },
];

describe('rulesFor', () => {
  it('post sem campanha: só as regras ligadas da marca', () => {
    expect(rulesFor(rules, null, TODAY)).toEqual(['Fechar com CTA para o WhatsApp']);
  });

  it('post da campanha em vigor: as da marca e as dela, nunca as de outra campanha', () => {
    expect(rulesFor(rules, campaign(), TODAY)).toEqual(['Fechar com CTA para o WhatsApp', 'Tom festivo, contagem regressiva']);
  });

  it('campanha encerrada, pausada, sem confirmar ou fora do prazo: a regra dela fica fora', () => {
    for (const c of [campaign({ status: 'ended' }), campaign({ status: 'paused' }), campaign({ confirmedAt: null }), campaign({ endDate: '2026-11-01' })]) {
      expect(rulesFor(rules, c, TODAY)).toEqual(['Fechar com CTA para o WhatsApp']);
    }
  });

  it('regra antiga sem campaign_id vale na marca toda', () => {
    expect(rulesFor([{ rule: 'Antiga', active: true }], campaign(), TODAY)).toEqual(['Antiga']);
  });
});

describe('a tela', () => {
  it('ruleScope: marca, campanha em vigor ou fora', () => {
    expect(ruleScope({ campaign_id: null }, [campaign()], TODAY)).toEqual({ kind: 'brand' });
    expect(ruleScope({ campaign_id: C }, [campaign()], TODAY)).toEqual({ kind: 'campaign', campaignId: C, inEffect: true });
    expect(ruleScope({ campaign_id: C }, [campaign({ status: 'ended' })], TODAY)).toEqual({ kind: 'campaign', campaignId: C, inEffect: false });
  });

  it('ruleCampaigns: o porquê de não valer e se ainda aceita regra', () => {
    const view = (extra) => ruleCampaigns([campaign(extra)], (n) => n.split(' ')[0], TODAY)[0];
    expect(view({})).toEqual({ id: C, name: 'Encomendas', open: true, inEffect: true, offLabel: null, endLabel: '15/12' });
    expect(view({ status: 'paused' })).toMatchObject({ open: true, inEffect: false, offLabel: 'Campanha pausada' });
    expect(view({ status: 'ended' })).toMatchObject({ open: false, offLabel: 'Campanha encerrada' });
    expect(view({ status: 'draft' })).toMatchObject({ open: true, offLabel: 'Campanha em rascunho' });
    expect(view({ endDate: '2026-11-01' })).toMatchObject({ offLabel: 'Campanha fora do prazo' });
  });

  it('changeOf: a mudança que a versão nova registra', () => {
    expect(changeOf({ edited: true, active: true })).toBe('edited');
    expect(changeOf({ edited: false, active: false })).toBe('off');
    expect(changeOf({ edited: false, active: true })).toBe('on');
  });
});

describe('fronteira', () => {
  it('onde vale: marca (ausente, vazio ou "marca") ou o id da campanha', () => {
    const base = { rule: 'Sem emoji', aspect: 'tom' };
    expect(parseRuleInput(base)).toMatchObject({ ok: true, value: { campaign_id: null } });
    expect(parseRuleInput({ ...base, campaign_id: '' })).toMatchObject({ ok: true, value: { campaign_id: null } });
    expect(parseRuleInput({ ...base, campaign_id: 'marca' })).toMatchObject({ ok: true, value: { campaign_id: null } });
    expect(parseRuleInput({ ...base, campaign_id: C })).toMatchObject({ ok: true, value: { campaign_id: C } });
    expect(parseRuleInput({ ...base, campaign_id: 'x' }).ok).toBe(false);
  });

  it('restaurar: número de versão inteiro e positivo', () => {
    expect(parseRestore({ version: 2 })).toEqual({ ok: true, value: { version: 2 } });
    for (const v of [0, -1, 1.5, 'x', undefined]) expect(parseRestore({ version: v }).ok).toBe(false);
  });
});
