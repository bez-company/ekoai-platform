// Base da aprovação (SPEC 035, BEZ-543): o que o post afirmava quando foi aprovado, e o que mudou até a hora de sair.
import { describe, it, expect } from 'vitest';
import { basisBlocks, basisFor, parseApprovalBasis } from '../platform/src/lib/approval-basis-model.ts';
import { preflightBlocks } from '../platform/src/lib/publish-preflight-model.ts';

const TODAY = '2026-11-10';
const fact = (id, text, extra = {}) => ({
  id,
  kind: 'fact',
  text,
  source: 'owner',
  sourceNote: null,
  active: true,
  createdAt: '2026-10-01T00:00:00Z',
  status: 'confirmed',
  category: 'oferta_preco',
  proposedBy: 'person',
  verifiedAt: '2026-10-01T00:00:00Z',
  approvedBy: null,
  validUntil: null,
  expiryNotice: null,
  ...extra,
});
const PRICE = fact('f1', 'Bolo de pote por R$ 18');
const AREA = fact('f2', 'Entregamos em toda a região de Marília', { category: 'contato_endereco' });
const OTHER = fact('f3', 'Fundada em 2010', { category: 'sobre_a_empresa' });
const texts = ['Bolo de pote por R$ 18 e entregamos em toda a região de Marília!'];
const at = '2026-11-04T12:00:00Z';

describe('basisFor', () => {
  it('guarda o fato pelo número que o post repete e o fato sem número pelo texto inteiro', () => {
    const basis = basisFor({ texts, facts: [PRICE, AREA, OTHER, fact('n1', 'melhor da cidade', { kind: 'never' })], campaign: null, at });
    expect(basis).toEqual({ at, facts: [{ id: 'f1', text: 'Bolo de pote por R$ 18' }, { id: 'f2', text: 'Entregamos em toda a região de Marília' }], campaign: null });
  });

  it('fato desligado não entra; a campanha vai com a oferta', () => {
    const basis = basisFor({ texts, facts: [fact('f1', 'Bolo de pote por R$ 18', { active: false })], campaign: { id: 'c1', offering: '10% na primeira encomenda' }, at });
    expect(basis.facts).toEqual([]);
    expect(basis.campaign).toEqual({ id: 'c1', offering: '10% na primeira encomenda' });
  });
});

describe('parseApprovalBasis', () => {
  it('lê a base que a aprovação gravou', () => {
    const basis = basisFor({ texts, facts: [PRICE], campaign: { id: 'c1', offering: null }, at });
    expect(parseApprovalBasis(JSON.parse(JSON.stringify(basis)))).toEqual(basis);
  });

  it('forma errada vira sem base', () => {
    for (const raw of [null, 'x', [], { at }, { at, facts: [{ id: 1 }] }, { at, facts: [], campaign: { id: 'c1', offering: 3 } }]) expect(parseApprovalBasis(raw)).toBeNull();
  });
});

describe('basisBlocks', () => {
  const basis = basisFor({ texts, facts: [PRICE, AREA], campaign: { id: 'c1', offering: 'R$ 18 no pote' }, at });
  const run = (facts, campaign = { id: 'c1', offering: 'R$ 18 no pote' }) => basisBlocks({ basis, texts, facts, campaign, today: TODAY }).map((b) => b.rule);

  it('nada mudou: passa', () => {
    expect(run([PRICE, AREA])).toEqual([]);
  });

  it('fato editado, apagado, desligado ou vencido segura', () => {
    expect(run([fact('f1', 'Bolo de pote por R$ 20'), AREA])).toEqual(['fact_changed']);
    expect(run([AREA])).toEqual(['fact_removed']);
    expect(run([fact('f1', 'Bolo de pote por R$ 18', { active: false }), AREA])).toEqual(['fact_off']);
    expect(run([fact('f1', 'Bolo de pote por R$ 18', { validUntil: '2026-11-05' }), AREA])).toEqual(['fact_off']);
  });

  it('espaço ou acento a mais no fato não conta como edição', () => {
    expect(run([fact('f1', 'Bolo de pote por  R$ 18 '), AREA])).toEqual([]);
  });

  it('oferta da campanha mudou: segura só se o post repete um número da oferta antiga', () => {
    expect(run([PRICE, AREA], { id: 'c1', offering: 'R$ 20 no pote' })).toEqual(['offering_changed']);
    const noNumber = basisFor({ texts, facts: [PRICE, AREA], campaign: { id: 'c1', offering: '10% na primeira encomenda' }, at });
    expect(basisBlocks({ basis: noNumber, texts, facts: [PRICE, AREA], campaign: { id: 'c1', offering: '15% na primeira encomenda' }, today: TODAY })).toEqual([]);
  });

  it('a mensagem mostra o antes e o depois', () => {
    const [b] = basisBlocks({ basis, texts, facts: [fact('f1', 'Bolo de pote por R$ 20'), AREA], campaign: null, today: TODAY });
    expect(b.message).toBe('O fato mudou depois que o post foi aprovado: era "Bolo de pote por R$ 18", agora é "Bolo de pote por R$ 20". Atualize o post.');
    expect(b.message).not.toMatch(/[—–]/);
  });
});

describe('preflightBlocks com a base', () => {
  const base = { texts, campaign: null, photo: { linked: false, asset: null }, today: TODAY };
  const basis = basisFor({ texts, facts: [PRICE], campaign: null, at });

  it('fato editado: sem base passava; com base segura', () => {
    const facts = [fact('f1', 'Bolo de pote por R$ 20')];
    expect(preflightBlocks({ ...base, facts })).toEqual([]);
    expect(preflightBlocks({ ...base, facts, basis }).map((b) => b.rule)).toEqual(['fact_changed']);
  });

  it('fato vencido com base: um aviso só, não dois', () => {
    const facts = [fact('f1', 'Bolo de pote por R$ 18', { validUntil: '2026-11-05' })];
    expect(preflightBlocks({ ...base, facts }).map((b) => b.rule)).toEqual(['fact_not_valid']);
    expect(preflightBlocks({ ...base, facts, basis }).map((b) => b.rule)).toEqual(['fact_off']);
  });
});
