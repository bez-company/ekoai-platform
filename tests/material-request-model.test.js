// Pedido de material (SPEC 036, BEZ-549): quando a regra pede, o quê, e quando fica quieta.
import { describe, it, expect } from 'vitest';
import { materialAsk, needsReminder, parseAnswerConfirm, parseAnswerPhoto, OPEN_MAX } from '../platform/src/lib/material-request-model.ts';

const now = new Date('2026-10-22T12:00:00Z');
const today = '2026-10-22';
const sug = (id, goal, extra = {}) => ({ id, slotAt: '2026-10-24T21:00:00Z', goal, idea: 'Caixa de panetone com doce de leite', assetId: null, campaignId: null, ...extra });
const fact = (id, extra = {}) => ({
  id, kind: 'fact', text: 'Caixa de panetone por R$ 89', source: 'owner', sourceNote: null, active: true, createdAt: '2026-10-01T00:00:00Z',
  status: 'confirmed', category: 'oferta_preco', proposedBy: 'person', verifiedAt: '2026-10-01T00:00:00Z', approvedBy: null, validUntil: '2026-10-25', expiryNotice: null, ...extra,
});
const base = { now, today, suggestions: [], photos: [], facts: [], past: [] };
const ask = (input) => materialAsk({ ...base, ...input });

describe('materialAsk: foto', () => {
  it('sugestão de produto sem foto no banco pede foto, com o post e o prazo', () => {
    const a = ask({ suggestions: [sug('s1', 'produto')] });
    expect(a).toMatchObject({ kind: 'photo', needTag: 'produto', suggestionId: 's1', dueAt: '2026-10-24T21:00:00Z', campaignId: null });
    expect(a.title).toBe('Fotos para o post "Caixa de panetone com doce de leite"');
    expect(a.reason).toContain('o banco não tem foto de produto');
    expect(a.reason).not.toMatch(/[—–]/);
  });

  it('com foto que pode ser sugerida, sugestão que já tem foto ou objetivo sem foto real: não pede', () => {
    expect(ask({ suggestions: [sug('s1', 'produto')], photos: [{ tags: ['produto'], suggestable: true }] })).toBeNull();
    expect(ask({ suggestions: [sug('s1', 'produto', { assetId: 'a1' })] })).toBeNull();
    expect(ask({ suggestions: [sug('s1', 'ensinar'), sug('s2', 'conversa')] })).toBeNull();
  });

  it('foto usada há pouco (não sugerível) não conta: pede', () => {
    expect(ask({ suggestions: [sug('s1', 'produto')], photos: [{ tags: ['produto'], suggestable: false }] })).toMatchObject({ kind: 'photo' });
  });

  it('bastidores pede bastidor; prova social pede foto de cliente', () => {
    expect(ask({ suggestions: [sug('s1', 'bastidores')] }).needTag).toBe('bastidor');
    expect(ask({ suggestions: [sug('s1', 'prova_social')] }).needTag).toBe('cliente');
  });

  it('post de campanha vem antes do post comum', () => {
    const a = ask({ suggestions: [sug('s1', 'produto', { slotAt: '2026-10-23T21:00:00Z' }), sug('s2', 'bastidores', { campaignId: 'c1' })] });
    expect(a).toMatchObject({ suggestionId: 's2', campaignId: 'c1' });
    expect(a.reason).toMatch(/^O post da campanha/);
  });

  it('sugestão que já passou não pede', () => {
    expect(ask({ suggestions: [sug('s1', 'produto', { slotAt: '2026-10-22T11:00:00Z' })] })).toBeNull();
  });
});

describe('materialAsk: pouco e com prazo', () => {
  const open = (needTag, extra = {}) => ({ kind: 'photo', status: 'open', needTag, factId: null, createdAt: '2026-10-21T12:00:00Z', answeredAt: null, ...extra });

  it(`com ${OPEN_MAX} abertos, não pede mais nada`, () => {
    expect(ask({ suggestions: [sug('s1', 'produto')], past: [open('bastidor'), open('cliente')] })).toBeNull();
  });

  it('o mesmo pedido aberto não se repete; outro tipo passa', () => {
    expect(ask({ suggestions: [sug('s1', 'produto')], past: [open('produto')] })).toBeNull();
    expect(ask({ suggestions: [sug('s1', 'produto'), sug('s2', 'bastidores')], past: [open('produto')] })).toMatchObject({ needTag: 'bastidor' });
  });

  it('"Não tenho agora" ou vencido pausa o mesmo pedido por 14 dias', () => {
    const dismissed = (days) => open('produto', { status: 'dismissed', answeredAt: new Date(now.getTime() - days * 86_400_000).toISOString() });
    expect(ask({ suggestions: [sug('s1', 'produto')], past: [dismissed(3)] })).toBeNull();
    expect(ask({ suggestions: [sug('s1', 'produto')], past: [open('produto', { status: 'expired', answeredAt: '2026-10-20T12:00:00Z' })] })).toBeNull();
    expect(ask({ suggestions: [sug('s1', 'produto')], past: [dismissed(15)] })).toMatchObject({ kind: 'photo' });
  });

  it('respondido não pausa: se faltar foto de novo, pede', () => {
    expect(ask({ suggestions: [sug('s1', 'produto')], past: [open('produto', { status: 'answered', answeredAt: '2026-10-21T12:00:00Z' })] })).toMatchObject({ kind: 'photo' });
  });
});

describe('materialAsk: confirmar fato', () => {
  const campaignPost = sug('s1', 'ensinar', { campaignId: 'c1' });

  it('post de campanha e preço que vence em até 7 dias: pede confirmação', () => {
    const a = ask({ suggestions: [campaignPost], facts: [fact('f1')] });
    expect(a).toMatchObject({ kind: 'confirm', factId: 'f1', suggestionId: 's1', campaignId: 'c1' });
    expect(a.title).toBe('"Caixa de panetone por R$ 89" continua valendo?');
    expect(a.reason).toContain('vence em 25/10');
  });

  it('sem post de campanha, fato longe de vencer, desligado, para revisar ou de outra categoria: não pede', () => {
    expect(ask({ suggestions: [sug('s1', 'ensinar')], facts: [fact('f1')] })).toBeNull();
    expect(ask({ suggestions: [campaignPost], facts: [fact('f1', { validUntil: '2026-12-15' })] })).toBeNull();
    expect(ask({ suggestions: [campaignPost], facts: [fact('f1', { active: false })] })).toBeNull();
    expect(ask({ suggestions: [campaignPost], facts: [fact('f1', { status: 'pending' })] })).toBeNull();
    expect(ask({ suggestions: [campaignPost], facts: [fact('f1', { category: 'sobre_a_empresa' })] })).toBeNull();
  });

  it('foto da campanha vem antes da confirmação', () => {
    expect(ask({ suggestions: [sug('s1', 'produto', { campaignId: 'c1' })], facts: [fact('f1')] })).toMatchObject({ kind: 'photo' });
  });
});

describe('needsReminder', () => {
  const r = (dueAt, remindedAt = null) => ({ status: 'open', dueAt, remindedAt });
  it('um lembrete só, quando falta até 24 h', () => {
    expect(needsReminder(r('2026-10-23T06:00:00Z'), now)).toBe(true);
    expect(needsReminder(r('2026-10-24T21:00:00Z'), now)).toBe(false);
    expect(needsReminder(r('2026-10-23T06:00:00Z', '2026-10-22T10:00:00Z'), now)).toBe(false);
    expect(needsReminder(r('2026-10-22T11:00:00Z'), now)).toBe(false);
    expect(needsReminder({ ...r('2026-10-23T06:00:00Z'), status: 'answered' }, now)).toBe(false);
  });
});

describe('respostas', () => {
  it('foto: de 1 a 4 fotos, sem repetir', () => {
    const id = (n) => `7d3f0c1e-2b4a-4c5d-8e9f-0a1b2c3d4e5${n}`;
    expect(parseAnswerPhoto({ assetIds: [id(1), id(1), id(2)] })).toEqual({ ok: true, value: { assetIds: [id(1), id(2)] } });
    expect(parseAnswerPhoto({ assetIds: ['x'] }).ok).toBe(false);
    expect(parseAnswerPhoto({ assetIds: [] }).ok).toBe(false);
    expect(parseAnswerPhoto({ assetIds: [1, 2, 3, 4, 5].map(id) }).ok).toBe(false);
  });

  it('confirmar: continua, mudou ou não vale mais', () => {
    expect(parseAnswerConfirm({ action: 'keep', valid_until: '2026-12-15' })).toEqual({ ok: true, value: { action: 'keep', validUntil: '2026-12-15' } });
    expect(parseAnswerConfirm({ action: 'edit', text: 'Caixa por R$ 95' })).toEqual({ ok: true, value: { action: 'edit', text: 'Caixa por R$ 95', validUntil: null } });
    expect(parseAnswerConfirm({ action: 'off' })).toEqual({ ok: true, value: { action: 'off' } });
    expect(parseAnswerConfirm({ action: 'talvez' }).ok).toBe(false);
  });
});
