import { describe, it, expect } from 'vitest';
import {
  parseFactInput,
  parseFactPatch,
  parseAgentFactInput,
  parseConfirmMany,
  factFromRow,
  factsForPrompt,
  factStanding,
  suggestedValidUntil,
  todayLocal,
  addDays,
  FACT_MAX,
  CONFIRM_MANY_MAX,
} from '../platform/src/lib/company-facts-model.ts';

const TODAY = '2026-10-22';

describe('fatos da empresa: entrada', () => {
  it('aceita fato com fonte e limpa espaços', () => {
    const r = parseFactInput({ kind: 'fact', text: '  Entregamos no mesmo   dia em Marília ', source: 'site', source_note: ' doceponto.com.br/entrega ', tenant_id: 'x' });
    expect(r).toEqual({ ok: true, value: { kind: 'fact', text: 'Entregamos no mesmo dia em Marília', source: 'site', source_note: 'doceponto.com.br/entrega', category: 'outro', valid_until: null } });
  });

  it('sem fonte vale "quem administra"; sem texto ou texto longo recusa com o campo', () => {
    expect(parseFactInput({ kind: 'never', text: 'garantia de resultado' })).toMatchObject({ ok: true, value: { source: 'owner', source_note: null } });
    expect(parseFactInput({ kind: 'fact', text: '' })).toMatchObject({ ok: false, field: 'text' });
    expect(parseFactInput({ kind: 'fact', text: 'x'.repeat(FACT_MAX + 1) })).toMatchObject({ ok: false, field: 'text' });
    expect(parseFactInput({ kind: 'promessa', text: 'x' })).toMatchObject({ ok: false, field: 'kind' });
    expect(parseFactInput({ kind: 'fact', text: 'x', source: 'tv' })).toMatchObject({ ok: false, field: 'source' });
  });

  it('o patch exige id válido e pelo menos um campo', () => {
    expect(parseFactPatch({ id: 'nope', active: false })).toMatchObject({ ok: false });
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parseFactPatch({ id })).toMatchObject({ ok: false, error: 'Nada para alterar.' });
    expect(parseFactPatch({ id, active: false })).toEqual({ ok: true, value: { id, active: false } });
    expect(parseFactPatch({ id, text: ' novo ', source_note: '' })).toEqual({ ok: true, value: { id, text: 'novo', source_note: null } });
    expect(parseFactPatch({ id, active: 'sim' })).toMatchObject({ ok: false, field: 'active' });
  });
});

describe('fatos da empresa: saída', () => {
  it('converte a linha e separa o que vai ao agente (só os ativos)', () => {
    const rows = [
      { id: '1', kind: 'fact', text: 'Sem conservantes', source: 'owner', source_note: null, active: true, created_at: new Date('2026-10-21T00:00:00Z') },
      { id: '2', kind: 'fact', text: 'Fato desligado', source: 'site', source_note: 'x', active: false, created_at: '2026-10-21' },
      { id: '3', kind: 'never', text: 'cura', source: 'owner', source_note: null, active: true, created_at: '2026-10-21' },
    ].map(factFromRow);
    expect(rows[0]).toMatchObject({ id: '1', createdAt: '2026-10-21T00:00:00.000Z', active: true });
    expect(factsForPrompt(rows, TODAY)).toEqual({ facts: ['Sem conservantes'], never: ['cura'], inactive: [] });
  });
});

const fact = (over = {}) => factFromRow({ id: '1', kind: 'fact', text: 'Frete grátis até 29/10', source: 'owner', source_note: null, active: true, created_at: '2026-10-01', status: 'confirmed', category: 'oferta_preco', proposed_by: 'person', verified_at: '2026-10-01T10:00:00Z', approved_by: 'u1', valid_until: '2026-10-29', expiry_notice: null, ...over });

describe('fatos da empresa: categoria e validade', () => {
  it('a categoria sugere a validade; sem categoria na lista, o fato não vence', () => {
    expect(suggestedValidUntil('oferta_preco', TODAY)).toBe('2026-11-21');
    expect(suggestedValidUntil('prazo_horario', TODAY)).toBe('2027-01-20');
    expect(suggestedValidUntil('numero_resultado', TODAY)).toBe('2027-04-20');
    expect(suggestedValidUntil('sobre_a_empresa', TODAY)).toBeNull();
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('ao criar, valid_until ausente usa a sugestão; vazio ou null não vence; data inválida ou passada recusa', () => {
    const base = { kind: 'fact', text: 'Bolo de pote por R$ 18', category: 'oferta_preco' };
    expect(parseFactInput(base, TODAY)).toMatchObject({ ok: true, value: { category: 'oferta_preco', valid_until: '2026-11-21' } });
    expect(parseFactInput({ ...base, valid_until: '' }, TODAY)).toMatchObject({ ok: true, value: { valid_until: null } });
    expect(parseFactInput({ ...base, valid_until: null }, TODAY)).toMatchObject({ ok: true, value: { valid_until: null } });
    expect(parseFactInput({ ...base, valid_until: '2026-12-15' }, TODAY)).toMatchObject({ ok: true, value: { valid_until: '2026-12-15' } });
    expect(parseFactInput({ ...base, valid_until: TODAY }, TODAY)).toMatchObject({ ok: true, value: { valid_until: TODAY } });
    expect(parseFactInput({ ...base, valid_until: '2026-10-21' }, TODAY)).toMatchObject({ ok: false, field: 'valid_until' });
    expect(parseFactInput({ ...base, valid_until: '2026-02-30' }, TODAY)).toMatchObject({ ok: false, field: 'valid_until' });
    expect(parseFactInput({ ...base, valid_until: '29/10/2026' }, TODAY)).toMatchObject({ ok: false, field: 'valid_until' });
    expect(parseFactInput({ ...base, category: 'preco' }, TODAY)).toMatchObject({ ok: false, field: 'category' });
  });

  it('"nunca afirmar" não tem categoria nem prazo', () => {
    expect(parseFactInput({ kind: 'never', text: 'cura', category: 'oferta_preco', valid_until: '2026-12-01' }, TODAY)).toMatchObject({ ok: true, value: { category: 'outro', valid_until: null } });
  });

  it('o patch aceita categoria e prazo; status e quem propôs não passam por aqui', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parseFactPatch({ id, valid_until: '2026-12-01', category: 'prazo_horario' }, TODAY)).toEqual({ ok: true, value: { id, valid_until: '2026-12-01', category: 'prazo_horario' } });
    expect(parseFactPatch({ id, valid_until: null }, TODAY)).toEqual({ ok: true, value: { id, valid_until: null } });
    expect(parseFactPatch({ id, status: 'confirmed', proposed_by: 'person' }, TODAY)).toMatchObject({ ok: false, error: 'Nada para alterar.' });
    expect(parseFactPatch({ id, valid_until: '2020-01-01' }, TODAY)).toMatchObject({ ok: false, field: 'valid_until' });
  });

  it('todayLocal usa o dia de Brasília (-3), inclusive na fronteira da meia-noite', () => {
    expect(todayLocal(new Date('2026-10-22T02:59:00Z'))).toBe('2026-10-21');
    expect(todayLocal(new Date('2026-10-22T03:00:00Z'))).toBe('2026-10-22');
  });
});

describe('fatos da empresa: em que pé está cada fato', () => {
  it('confirmado dentro do prazo vale; em até 7 dias avisa; no dia ainda vale; depois vence', () => {
    expect(factStanding(fact({ valid_until: '2026-12-15' }), TODAY)).toEqual({ state: 'valid', daysLeft: 54 });
    expect(factStanding(fact({ valid_until: '2026-10-29' }), TODAY)).toEqual({ state: 'soon', daysLeft: 7 });
    expect(factStanding(fact({ valid_until: '2026-10-30' }), TODAY)).toEqual({ state: 'valid', daysLeft: 8 });
    expect(factStanding(fact({ valid_until: TODAY }), TODAY)).toEqual({ state: 'soon', daysLeft: 0 });
    expect(factStanding(fact({ valid_until: '2026-10-21' }), TODAY)).toEqual({ state: 'expired', daysLeft: -1 });
    expect(factStanding(fact({ valid_until: null }), TODAY)).toEqual({ state: 'valid', daysLeft: null });
  });

  it('pendente, recusado e desligado não valem, qualquer que seja o prazo', () => {
    expect(factStanding(fact({ status: 'pending', verified_at: null }), TODAY).state).toBe('pending');
    expect(factStanding(fact({ status: 'rejected', verified_at: null }), TODAY).state).toBe('rejected');
    expect(factStanding(fact({ active: false }), TODAY).state).toBe('off');
  });

  it('"nunca afirmar" vale sempre que estiver ativo, mesmo pendente; só recusado ou desligado o tira', () => {
    expect(factStanding(fact({ kind: 'never', status: 'pending', verified_at: null, valid_until: '2020-01-01' }), TODAY).state).toBe('valid');
    expect(factStanding(fact({ kind: 'never', status: 'rejected', verified_at: null }), TODAY).state).toBe('rejected');
    expect(factStanding(fact({ kind: 'never', active: false }), TODAY).state).toBe('off');
  });

  it('factsForPrompt só entrega o que vale e separa o que não vale para o revisor', () => {
    const rows = [
      fact({ id: 'a', text: 'Entregamos no mesmo dia', valid_until: null }),
      fact({ id: 'b', text: 'Frete grátis até 29/10', valid_until: '2026-10-29' }),
      fact({ id: 'c', text: 'Bolo de pote por R$ 18', valid_until: '2026-10-15' }),
      fact({ id: 'd', text: 'Mais de 2 mil bolos entregues', status: 'pending', verified_at: null, proposed_by: 'agent' }),
      fact({ id: 'e', text: 'Entregamos em Bauru', status: 'rejected', verified_at: null }),
      fact({ id: 'f', text: 'Fato desligado', active: false }),
      fact({ id: 'g', kind: 'never', text: 'sem açúcar', status: 'pending', verified_at: null, valid_until: null }),
    ];
    expect(factsForPrompt(rows, TODAY)).toEqual({
      facts: ['Entregamos no mesmo dia', 'Frete grátis até 29/10'],
      never: ['sem açúcar'],
      inactive: [
        { text: 'Bolo de pote por R$ 18', reason: 'expired', validUntil: '2026-10-15' },
        { text: 'Mais de 2 mil bolos entregues', reason: 'pending', validUntil: '2026-10-29' },
        { text: 'Entregamos em Bauru', reason: 'rejected', validUntil: '2026-10-29' },
      ],
    });
  });

  it('factFromRow lê a data do pg (Date local) e do texto, e assume confirmado em linha antiga', () => {
    expect(fact({ valid_until: new Date(2026, 9, 29) }).validUntil).toBe('2026-10-29');
    expect(fact({ valid_until: '2026-10-29T00:00:00.000Z' }).validUntil).toBe('2026-10-29');
    expect(factFromRow({ id: '9', kind: 'fact', text: 'x', source: 'owner', active: true, created_at: '2026-10-01' })).toMatchObject({ status: 'confirmed', category: 'outro', proposedBy: 'person', validUntil: null, verifiedAt: null });
  });
});

describe('fatos da empresa: entrada de agente e confirmação em lote', () => {
  it('o agente só grava fato, com fonte https quando vem do site, e sempre com a sugestão de prazo', () => {
    const ok = parseAgentFactInput({ text: ' Mais de 2 mil bolos entregues ', source: 'site', source_note: 'https://doceponto.com.br/sobre', category: 'numero_resultado' }, TODAY);
    expect(ok).toEqual({ ok: true, value: { kind: 'fact', text: 'Mais de 2 mil bolos entregues', source: 'site', source_note: 'https://doceponto.com.br/sobre', category: 'numero_resultado', valid_until: '2027-04-20' } });
    expect(parseAgentFactInput({ text: 'x', source: 'site', source_note: 'http://doceponto.com.br' }, TODAY)).toMatchObject({ ok: false, field: 'source_note' });
    // nada que o corpo diga muda o estado: não há campo de status, de aprovador nem de quem propôs
    expect(parseAgentFactInput({ text: 'x', status: 'confirmed', approved_by: 'u1', proposed_by: 'person', kind: 'never' }, TODAY).value).toEqual({ kind: 'fact', text: 'x', source: 'site', source_note: null, category: 'outro', valid_until: null });
  });

  it('confirmar vários exige ids marcados, válidos e no máximo 50, sem duplicar', () => {
    const a = '11111111-2222-4333-8444-555555555555';
    const b = '11111111-2222-4333-8444-555555555556';
    expect(parseConfirmMany({ ids: [a, b, a] })).toEqual({ ok: true, value: [a, b] });
    expect(parseConfirmMany({})).toMatchObject({ ok: false, field: 'ids' });
    expect(parseConfirmMany({ ids: [] })).toMatchObject({ ok: false, field: 'ids' });
    expect(parseConfirmMany({ ids: [a, 'nope'] })).toMatchObject({ ok: false, field: 'ids' });
    expect(parseConfirmMany({ ids: Array.from({ length: CONFIRM_MANY_MAX + 1 }, () => a) })).toMatchObject({ ok: false, field: 'ids' });
    expect(parseConfirmMany({ all: true })).toMatchObject({ ok: false });
  });
});
