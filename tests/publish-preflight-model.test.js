// Conferência antes de publicar (BEZ-275): a regra pura. O post foi aprovado num dia; no dia de sair, fato, campanha e
// foto podem ter mudado. Cada caso aqui é uma dessas mudanças, e o que passa continua passando.
import { describe, it, expect } from 'vitest';
import { postTexts, preflightBlocks, preflightMessage } from '../platform/src/lib/publish-preflight-model.ts';

const TODAY = '2026-11-10';
const fact = (text, extra = {}) => ({
  id: text,
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
const never = (text) => fact(text, { kind: 'never', category: 'outro' });
const noPhoto = { linked: false, asset: null };
const base = { texts: ['Bolo de pote por R$ 18 nesta semana'], facts: [fact('Bolo de pote por R$ 18')], campaign: null, photo: noPhoto, today: TODAY };
const rules = (input) => preflightBlocks({ ...base, ...input }).map((b) => b.rule);

describe('preflightBlocks', () => {
  it('post sem mudança desde a aprovação passa', () => {
    expect(preflightBlocks(base)).toEqual([]);
  });

  it('o fato do preço venceu depois da aprovação: segura, com a data', () => {
    const blocks = preflightBlocks({ ...base, facts: [fact('Bolo de pote por R$ 18', { validUntil: '2026-11-05' })] });
    expect(blocks.map((b) => b.rule)).toEqual(['fact_not_valid']);
    expect(blocks[0].message).toContain('vencido em 05/11');
  });

  it('fato recusado ou voltado para revisão também segura', () => {
    expect(rules({ facts: [fact('Bolo de pote por R$ 18', { status: 'rejected' })] })).toEqual(['fact_not_valid']);
    expect(rules({ facts: [fact('Bolo de pote por R$ 18', { status: 'pending' })] })).toEqual(['fact_not_valid']);
  });

  it('o número continua valendo se outro fato vigente o afirma, ou se é a oferta da campanha ativa', () => {
    const expired = fact('Bolo de pote por R$ 18', { validUntil: '2026-11-05' });
    expect(rules({ facts: [expired, fact('Kit festa com bolo de R$ 18')] })).toEqual([]);
    expect(rules({ facts: [expired], campaign: { name: 'Dia das mães', status: 'active', endDate: null, offering: 'Bolo de pote por R$ 18' } })).toEqual([]);
  });

  it('frase que entrou em "nunca afirmar" depois da aprovação segura', () => {
    expect(rules({ texts: ['O melhor bolo da cidade, por R$ 18'], facts: [fact('Bolo de pote por R$ 18'), never('melhor bolo da cidade')] })).toEqual(['never_claim']);
  });

  it('campanha pausada segura; ativa passa', () => {
    expect(rules({ campaign: { name: 'Natal', status: 'paused', endDate: null, offering: null } })).toEqual(['campaign_paused']);
    expect(rules({ campaign: { name: 'Natal', status: 'active', endDate: '2026-12-24', offering: null } })).toEqual([]);
  });

  it('campanha encerrada, arquivada ou com o fim já passado segura', () => {
    expect(rules({ campaign: { name: 'Natal', status: 'ended', endDate: null, offering: null } })).toEqual(['campaign_ended']);
    expect(rules({ campaign: { name: 'Natal', status: 'archived', endDate: null, offering: null } })).toEqual(['campaign_ended']);
    const late = preflightBlocks({ ...base, campaign: { name: 'Black Friday', status: 'active', endDate: '2026-11-09', offering: null } });
    expect(late.map((b) => b.rule)).toEqual(['campaign_ended']);
    expect(late[0].message).toContain('terminou em 09/11');
    expect(rules({ campaign: { name: 'Black Friday', status: 'active', endDate: TODAY, offering: null } })).toEqual([]);
  });

  it('a oferta de campanha encerrada não vale mais como afirmada', () => {
    const expired = fact('Bolo de pote por R$ 18', { validUntil: '2026-11-05' });
    expect(rules({ facts: [expired], campaign: { name: 'Natal', status: 'ended', endDate: null, offering: 'Bolo de pote por R$ 18' } })).toEqual(['campaign_ended', 'fact_not_valid']);
  });

  it('foto com pessoas que perdeu a autorização segura; sem pessoas ou autorizada passa', () => {
    expect(rules({ photo: { linked: true, asset: { hasPeople: true, peopleConsent: false } } })).toEqual(['photo_no_consent']);
    expect(rules({ photo: { linked: true, asset: { hasPeople: true, peopleConsent: true } } })).toEqual([]);
    expect(rules({ photo: { linked: true, asset: { hasPeople: false, peopleConsent: false } } })).toEqual([]);
  });

  it('foto que saiu do banco de imagens segura', () => {
    expect(rules({ photo: { linked: true, asset: null } })).toEqual(['photo_removed']);
  });
});

describe('preflightMessage', () => {
  it('junta os motivos e diz o próximo passo uma vez', () => {
    const blocks = preflightBlocks({ ...base, campaign: { name: 'Natal', status: 'paused', endDate: null, offering: null }, photo: { linked: true, asset: { hasPeople: true, peopleConsent: false } } });
    const msg = preflightMessage(blocks);
    expect(msg).toContain('"Natal" está pausada');
    expect(msg).toContain('autorização de uso de imagem');
    expect(msg.match(/publique agora ou reagende/g)).toHaveLength(1);
    expect(msg).not.toMatch(/[—–]/);
  });

  it('foto apagada não manda reagendar: o post tem de ser criado de novo', () => {
    expect(preflightMessage(preflightBlocks({ ...base, photo: { linked: true, asset: null } }))).not.toContain('reagende');
  });

  it('sem motivo, sem mensagem', () => {
    expect(preflightMessage([])).toBe('');
  });
});

describe('postTexts', () => {
  it('lê legenda, gancho, corpo, lâminas e textos alternativos', () => {
    const texts = postTexts({
      caption_final: 'Legenda #bolo',
      variation: { id: 1, hook: 'Gancho', body: 'Corpo', slides: ['Lâmina 1', { title: 'Lâmina 2', n: 2 }] },
      generation: { variations: [], alt_text: 'Foto do bolo', slide_alts: ['Alt 1'] },
    });
    expect(texts).toEqual(['Legenda #bolo', 'Gancho', 'Corpo', 'Lâmina 1', 'Lâmina 2', 'Foto do bolo', 'Alt 1']);
  });

  it('agendado antigo sem variação nem geração não quebra', () => {
    expect(postTexts({ caption_final: 'Só legenda', variation: null, generation: null })).toEqual(['Só legenda']);
  });
});
