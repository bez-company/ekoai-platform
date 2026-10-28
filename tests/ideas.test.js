import { describe, it, expect } from 'vitest';
import { groupIdeas, roleOf, motherOf, parseApproveIdea, parseRework, reviewHref, hasPostScreen } from '../platform/src/lib/ideas-model.ts';

const BRIEF = 'b-1';
const plan = {
  linkedin: { mode: 'mother' },
  instagram: { mode: 'own' },
  twitter: { mode: 'locked', reason: 'twitter ainda não publica' },
};

const pending = (channel, extra = {}) => ({
  id: channel,
  pending_id: `${channel}-x`,
  channel,
  generation: { variations: [{ id: 1, hook: `h ${channel}` }] },
  top_id: 1,
  regen_count: 0,
  status: 'awaiting_decision',
  saved_at: '2026-10-16T10:00:00Z',
  ...extra,
});

describe('groupIdeas', () => {
  const ig = pending('instagram', { seed: { brief_id: BRIEF, mother_channel: 'linkedin', reuse_plan: plan } });
  const li = pending('linkedin', { brief_id: BRIEF, seed: { brief_id: BRIEF, mother_channel: 'linkedin', reuse_plan: plan } });
  const old = pending('instagram', { pending_id: 'instagram-old', seed: {} });

  it('junta a mesma rodada (pelo brief_id da coluna ou do seed), mãe primeiro', () => {
    const ideas = groupIdeas([ig, li, old]);
    expect(ideas).toHaveLength(2);
    expect(ideas[0].briefId).toBe(BRIEF);
    expect(ideas[0].pendings.map(p => p.channel)).toEqual(['linkedin', 'instagram']);
    expect(motherOf(ideas[0]).channel).toBe('linkedin');
  });

  it('pendência sem ideia fica avulsa, com a própria chave', () => {
    const ideas = groupIdeas([old]);
    expect(ideas[0]).toMatchObject({ key: 'instagram-old', briefId: null, absent: [] });
  });

  it('rede do plano sem pendência aparece como travada ou pulada', () => {
    expect(groupIdeas([ig, li])[0].absent).toEqual([{ channel: 'twitter', mode: 'locked', reason: 'twitter ainda não publica' }]);
  });
});

describe('roleOf', () => {
  it('mãe, reaproveitado, próprio e avulso', () => {
    const seed = { brief_id: BRIEF, mother_channel: 'linkedin', reuse_plan: plan };
    expect(roleOf(pending('linkedin', { seed }))).toBe('mother');
    expect(roleOf(pending('twitter', { seed, generation: { variations: [], reuse: { from_channel: 'linkedin' } } }))).toBe('reuse');
    expect(roleOf(pending('instagram', { seed }))).toBe('own');
    expect(roleOf(pending('instagram', { seed: {} }))).toBe('single');
  });
});

describe('parseApproveIdea', () => {
  const item = { pendingId: 'linkedin-x', enabled: true, captionId: 2, artId: 2 };

  it('aceita e normaliza', () => {
    const r = parseApproveIdea({ briefId: BRIEF, items: [item, { pendingId: 'instagram-x', enabled: false, captionId: 1 }] });
    expect(r.ok).toBe(true);
    expect(r.value.items[1]).toMatchObject({ enabled: false, captionId: 1, artId: 1 });
  });

  it('recusa sem rede ligada, sem ideia ou com horário inválido', () => {
    expect(parseApproveIdea({ briefId: BRIEF, items: [{ ...item, enabled: false }] })).toMatchObject({ ok: false, error: expect.stringMatching(/Ligue/) });
    expect(parseApproveIdea({ items: [item] }).ok).toBe(false);
    expect(parseApproveIdea({ briefId: BRIEF, items: [{ ...item, scheduledFor: 'amanhã' }] }).ok).toBe(false);
    expect(parseApproveIdea({ briefId: BRIEF, items: [{ ...item, captionId: 'x' }] }).ok).toBe(false);
  });
});

describe('parseRework', () => {
  it('só post próprio ou reaproveitar', () => {
    expect(parseRework({ pendingId: 'p', mode: 'own' })).toEqual({ ok: true, value: { pendingId: 'p', mode: 'own', sourceVariationId: undefined } });
    expect(parseRework({ pendingId: 'p', mode: 'reuse', sourceVariationId: '3' }).value.sourceVariationId).toBe(3);
    expect(parseRework({ pendingId: 'p', mode: 'apagar' }).ok).toBe(false);
    expect(parseRework({ mode: 'own' }).ok).toBe(false);
  });
});

describe('reviewHref: para onde a lista Aprovar leva o cartão', () => {
  const withBrief = (extra) => pending('instagram', { brief_id: BRIEF, seed: { brief_id: BRIEF }, ...extra });

  it('post com design da Ekoai abre a tela do post (imagem, Studio e ajuste), mesmo com brief_id', () => {
    const [idea] = groupIdeas([withBrief({ post_design_id: 'd-1' })]);
    expect(reviewHref(idea)).toBe('/aprovar/instagram-x');
    expect(hasPostScreen(idea.pendings[0])).toBe(true);
  });

  it('foto do banco abre a tela do post', () => {
    const [idea] = groupIdeas([pending('instagram', { seed: { source: 'photo' } })]);
    expect(reviewHref(idea)).toBe('/aprovar/instagram-x');
  });

  it('pendência por rede (sem design) segue na tela por ideia; avulsa abre a própria', () => {
    const [idea] = groupIdeas([withBrief({})]);
    expect(reviewHref(idea)).toBe('/aprovar/ideia/b-1');
    const [alone] = groupIdeas([pending('instagram', { seed: {} })]);
    expect(reviewHref(alone)).toBe('/aprovar/instagram-x');
  });
});
