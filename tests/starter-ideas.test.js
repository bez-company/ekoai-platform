// "Sugerir ideias" do Criar post (SPEC 025): o prompt, a conferência da resposta do modelo e a linha de design. Puro, sem modelo.
import { describe, it, expect } from 'vitest';
import { buildIdeasPrompt, designLine, parseIdeas, profileReady } from '../platform/src/lib/starter-ideas-model.ts';

const profile = {
  niche: 'Alimentação', offering: 'Bolos e doces para festa', audience: 'Famílias de Marília', region: 'Marília, SP', siteUrl: null, instagramHandle: null,
  differentiators: ['Entrega no mesmo dia'], pains: ['Não sabe quanto bolo pedir'], voiceFormal: 4, voiceTechnical: 4, voiceSerious: 3, bannedWords: ['gourmet'],
  logoAssetId: null, colorPrimary: '#B83262', colorAccent: '#4A2C2A', fontHeading: 'Playfair Display', fontBody: 'DM Sans', ctaDefault: null, postsPerWeek: null, updatedAt: '2026-10-27',
};
const idea = (i, goal = 'ensinar', format = 'single') => ({ idea: `Ideia número ${i} do bolo`, goal, format });

describe('perfil pronto', () => {
  it('exige nicho, o que vende e para quem', () => {
    expect(profileReady(profile)).toBe(true);
    expect(profileReady(null)).toBe(false);
    for (const k of ['niche', 'offering', 'audience']) expect(profileReady({ ...profile, [k]: ' ' }), k).toBe(false);
  });
});

describe('prompt', () => {
  it('leva o perfil, os fatos e as proibições, e pede 6 ideias', () => {
    const p = buildIdeasPrompt({ profile, facts: ['Entrega até 18h'], never: ['frete grátis'] });
    expect(p).toContain('Bolos e doces para festa');
    expect(p).toContain('Entrega até 18h');
    expect(p).toContain('Nunca afirma: frete grátis');
    expect(p).toContain('Palavras proibidas: gourmet');
    expect(p).toContain('exatamente 6 ideias');
    expect(p).not.toContain('data_comemorativa');
  });
});

describe('parseIdeas', () => {
  it('aceita 6 ideias e dicas, limpa travessão e dá id e rótulo do objetivo', () => {
    const r = parseIdeas({ ideas: [1, 2, 3, 4, 5, 6].map((i) => idea(i, i % 2 ? 'ensinar' : 'bastidores', i === 1 ? 'carousel' : 'single')), tips: ['Foto — do produto', '', 'Carrossel para passo a passo', 'c', 'd'] });
    expect(r.ok).toBe(true);
    expect(r.value.ideas).toHaveLength(6);
    expect(r.value.ideas[0]).toMatchObject({ id: 'i1', goal: 'ensinar', goalLabel: 'Ensinar algo', format: 'carousel' });
    expect(r.value.ideas[1].format).toBe('single');
    expect(r.value.tips).toEqual(['Foto , do produto', 'Carrossel para passo a passo', 'c']);
  });

  it('descarta ideia vazia, repetida ou com objetivo fora da lista, e corta em 6', () => {
    const r = parseIdeas({ ideas: [idea(1), idea(1), { ...idea(2), goal: 'data_comemorativa' }, { idea: '', goal: 'ensinar' }, idea(3), idea(4), idea(5), idea(6), idea(7), idea(8)] });
    expect(r.ok).toBe(true);
    expect(r.value.ideas.map((i) => i.idea)).toEqual([1, 3, 4, 5, 6, 7].map((i) => `Ideia número ${i} do bolo`));
  });

  it('menos de 3 ideias aproveitáveis ou corpo errado é falha', () => {
    expect(parseIdeas({ ideas: [idea(1), idea(2)] }).ok).toBe(false);
    for (const bad of [null, [], 'x', {}, { ideas: 'x' }]) expect(parseIdeas(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe('linha de design', () => {
  it('usa as cores e as fontes do perfil, não as do modelo', () => {
    expect(designLine(profile, ['dica'])).toEqual({ colors: ['#B83262', '#4A2C2A'], fonts: { heading: 'Playfair Display', body: 'DM Sans' }, tips: ['dica'] });
    expect(designLine({ ...profile, colorPrimary: null, colorAccent: null, fontHeading: null, fontBody: null }, []).colors).toEqual([]);
  });
});
