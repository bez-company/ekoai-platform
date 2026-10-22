import { describe, it, expect } from 'vitest';
import { buildCopyPrompt, parseCopy, visualPromptFor, imageTextsOf, LIMITS, VISUAL_SUFFIX, buildRewritePrompt, parseRewrite, isRewriteMode } from '../platform/src/lib/agents.ts';

const profile = { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias de Marília', region: 'Marília, SP', siteUrl: null, instagramHandle: 'doceponto', differentiators: ['Entrega no dia'], pains: ['Bolo que chega amassado'], voiceFormal: 4, voiceTechnical: 5, voiceSerious: 3, bannedWords: ['imperdível'], logoAssetId: null, colorPrimary: null, colorAccent: null, fontHeading: null, fontBody: null, ctaDefault: 'whatsapp', postsPerWeek: null, updatedAt: '' };

describe('prompt dos agentes', () => {
  it('leva a empresa, os fatos, o que nunca afirma, as palavras proibidas e as regras aprendidas', () => {
    const p = buildCopyPrompt({ idea: 'bolo pronto', kind: 'informativo', profile, facts: ['Entrega no mesmo dia em Marília'], never: ['garantia de sabor'], rules: ['Sem gíria'] });
    for (const piece of ['Bolos sob encomenda', 'Entrega no mesmo dia em Marília', 'garantia de sabor', 'imperdível', 'Sem gíria', 'Tipo do post: informativo', 'chamar no WhatsApp', 'descontraído, simples', 'Nada de travessão']) expect(p).toContain(piece);
    expect(p).not.toContain('Versão anterior');
  });

  it('sem tipo, pede ao estrategista; sem fatos, proíbe número; com feedback, pede só a correção', () => {
    const p = buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [], feedback: [{ rule: 'banned_word', detail: 'imperdível', message: 'A palavra "imperdível" está na lista.', where: 'caption' }], previous: { kind: 'informativo', angle: '', texts: { title: 'T' }, caption: 'c', hashtags: [], visualPrompt: null } });
    expect(p).toContain('escolha entre "informativo"');
    expect(p).toContain('nenhum fato cadastrado');
    expect(p).toContain('A palavra "imperdível" está na lista.');
    expect(p).toContain('Versão anterior');
  });
});

describe('leitura da resposta', () => {
  it('normaliza e corta nos limites; itens só no informativo', () => {
    const r = parseCopy({ kind: 'informativo', angle: 'dica', texts: { kicker: ' Dica  da casa ', title: 'Seu bolo está pronto?', sub: 'x', items: ['a', 'b', 'c', 'd', 'e'] }, caption: 'Legenda', hashtags: ['#Bolo', 'bolo', 'bolo caseiro!', '#marília'] }, null);
    expect(r.ok).toBe(true);
    expect(r.value.texts).toEqual({ title: 'Seu bolo está pronto?', kicker: 'Dica da casa', sub: 'x', items: ['a', 'b', 'c', 'd'] });
    expect(r.value.hashtags).toEqual(['bolo', 'bolocaseiro', 'marília']);
    expect(r.value.visualPrompt).toBeNull();
    const long = parseCopy({ texts: { title: 't'.repeat(200) }, caption: 'c' }, 'informativo');
    expect(long.value.texts.title).toHaveLength(LIMITS.title);
  });

  it('o tipo pedido vence o do modelo; atmosfera exige visual_prompt e ignora itens', () => {
    const r = parseCopy({ kind: 'informativo', texts: { title: 'T', sub: 's', items: ['a', 'b'] }, caption: 'c', hashtags: [], visual_prompt: 'a cake on a wooden table' }, 'atmosfera');
    expect(r.ok).toBe(true);
    expect(r.value.kind).toBe('atmosfera');
    expect(r.value.texts).toEqual({ title: 'T' });
    expect(visualPromptFor(r.value)).toBe(`a cake on a wooden table ${VISUAL_SUFFIX}`);
    expect(parseCopy({ kind: 'atmosfera', texts: { title: 'T' }, caption: 'c' }, null)).toMatchObject({ ok: false });
  });

  it('recusa resposta sem título ou sem legenda, ou que não é objeto', () => {
    expect(parseCopy({ texts: {}, caption: 'c' }, null)).toMatchObject({ ok: false });
    expect(parseCopy({ texts: { title: 'T' } }, null)).toMatchObject({ ok: false });
    expect(parseCopy([], null)).toMatchObject({ ok: false });
  });

  it('lista os textos que vão para a imagem', () => {
    expect(imageTextsOf({ kind: 'informativo', angle: '', texts: { kicker: 'K', title: 'T', items: ['a'] }, caption: '', hashtags: [], visualPrompt: null })).toEqual(['K', 'T', 'a']);
  });
});

describe('direção e atalhos de legenda', () => {
  it('direção acima de 1 pede outro ângulo; a primeira não', () => {
    expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [], direction: 1 })).not.toContain('OUTRA direção');
    expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [], direction: 2 })).toContain('Direção 2');
  });

  it('o prompt de reescrita leva o pedido, a legenda e as regras; a resposta é normalizada', () => {
    const p = buildRewritePrompt({ mode: 'shorter', caption: 'Legenda atual', hashtags: ['bolo'], profile, facts: ['Entrega no dia'], never: ['cura'] });
    for (const piece of ['Encurte a legenda', 'Legenda atual', 'imperdível', 'Entrega no dia', 'cura', 'Hashtags atuais: bolo']) expect(p).toContain(piece);
    expect(parseRewrite({ caption: ' Nova ', hashtags: ['#Bolo', 'bolo', 'x y'] })).toEqual({ ok: true, caption: 'Nova', hashtags: ['bolo', 'xy'] });
    expect(parseRewrite({ hashtags: [] })).toMatchObject({ ok: false });
    expect(isRewriteMode('cta')).toBe(true);
    expect(isRewriteMode('louder')).toBe(false);
  });
});
