// O código obedece as instruções do pedido (SPEC 020, entrega c): plano antes do redator, composição depois e os
// revisores directive_*. Instrução que não cabe vira "Não aplicado" com o motivo, nunca some em silêncio.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { composeDesign, describeEach, planDirectives, reviewComposed, reviewCount, usedExactTexts, writerHints } from '../platform/src/lib/directives-apply.ts';
import { buildCopyPrompt } from '../platform/src/lib/agents.ts';
import { blocking } from '../platform/src/lib/design/review.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { brandFromProfile } from '../platform/src/lib/design/model.ts';
import { COMPANIES } from '../evals/cases.js';

const S = { kind: null, hasLogo: true, hasHandle: true, brandName: 'Casa Aurora' };
const copy = (extra = {}) => ({ kind: 'informativo', texts: { kicker: 'Dica', title: 'Título do redator', sub: 'Sub do redator', items: ['a', 'b', 'c'] }, ...extra });
const FONT_DIR = join(import.meta.dirname, '../platform/fonts');

describe('plano antes do redator', () => {
  it('fundo, nome ou logo fora do canto pedem o cartão de marca, que não tem foto nem lista', () => {
    for (const d of [{ background: 'dark' }, { elements: { name: 'bc' } }, { elements: { logo: 'c' } }, { elements: { handle: 'off' } }, { elements: { title: 'c' } }]) {
      const p = planDirectives(d, S);
      expect(p.brandCard, JSON.stringify(d)).toBe(true);
      expect(p.kind).toBe('informativo');
      expect(p.skipVisual).toBe(true);
    }
    expect(planDirectives({ background: 'dark', itemsCount: 3 }, S).notApplied.map((n) => n.key)).toEqual(['itemsCount']);
  });

  it('logo no canto, logo fora, texto exato, quantidade e "mais nada" ficam nas famílias de sempre', () => {
    const p = planDirectives({ elements: { logo: 'tr' }, exactTexts: ['Olá'], textOnly: true, itemsCount: 3, avoid: ['gíria'] }, S);
    expect(p).toMatchObject({ brandCard: false, kind: null, skipVisual: false, itemsCount: 3, avoid: ['gíria'], exactTexts: ['Olá'], textOnly: true, notApplied: [] });
    expect(planDirectives({ elements: { logo: 'off' }, elements2: 1 }, S).brandCard).toBe(false);
    expect(planDirectives({ elements: { name: 'off' } }, S).brandCard).toBe(false);
  });

  it('atmosfera: com fundo ou "sem foto" vira cartão; só com posição, mantém a foto e diz o que não deu', () => {
    const photo = { ...S, kind: 'atmosfera' };
    expect(planDirectives({ background: 'dark' }, photo)).toMatchObject({ brandCard: true, kind: 'informativo', skipVisual: true });
    expect(planDirectives({ noPhoto: true }, photo)).toMatchObject({ brandCard: true, skipVisual: true });
    const kept = planDirectives({ elements: { name: 'bc', logo: 'c', handle: 'br' }, itemsCount: 3 }, photo);
    expect(kept).toMatchObject({ brandCard: false, kind: 'atmosfera', skipVisual: false, itemsCount: null });
    expect(kept.notApplied.map((n) => n.key).sort()).toEqual(['elements.handle', 'elements.logo', 'elements.name', 'itemsCount']);
    expect(kept.notApplied.every((n) => n.why.length > 10)).toBe(true);
  });

  it('logo, @ ou nome pedidos sem existir na conta não somem em silêncio', () => {
    const p = planDirectives({ background: 'dark', elements: { logo: 'c', handle: 'br', name: 'bc' } }, { kind: null, hasLogo: false, hasHandle: false, brandName: null });
    expect(p.notApplied.map((n) => n.key).sort()).toEqual(['elements.handle', 'elements.logo', 'elements.name']);
    expect(p.notApplied.find((n) => n.key === 'elements.logo').why).toMatch(/Envie o logo/);
  });

  it('o prompt do redator leva só o que a pessoa ditou', () => {
    const profile = COMPANIES.aurora.profile;
    const p = planDirectives({ exactTexts: ['Aberto de terça a sábado'], itemsCount: 3, avoid: ['gíria', 'emoji'], textOnly: true }, S);
    const prompt = buildCopyPrompt({ idea: 'x', kind: p.kind, profile, facts: [], never: [], rules: [], directives: writerHints(p) });
    for (const piece of ['"Aberto de terça a sábado"', 'EXATAMENTE 3 itens', 'NÃO colocar: gíria; emoji']) expect(prompt).toContain(piece);
    const card = buildCopyPrompt({ idea: 'x', kind: 'informativo', profile, facts: [], never: [], rules: [], directives: writerHints(planDirectives({ background: 'dark' }, S)) });
    expect(card).toContain('cartão de marca liso, sem foto');
    expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [] })).not.toContain('A pessoa ditou');
  });
});

describe('composição depois do redator', () => {
  it('cartão de marca: só o que a pessoa pediu; o título do redator não entra sem ser pedido', () => {
    const d = { background: 'dark', elements: { logo: 'c', name: 'bc', handle: 'br' } };
    const out = composeDesign(d, planDirectives(d, S), copy(), S);
    expect(out).toMatchObject({ layout: 'marca', texts: { title: '' }, background: 'dark', brandName: 'Casa Aurora', placements: { logo: 'c', name: 'bc', handle: 'br' } });
    expect(out.notApplied).toEqual([]);
    expect(out.applied.map((a) => a.text)).toEqual(['Fundo escuro', 'O logo: centro', 'O nome da empresa: base, no centro', 'O @: canto inferior direito']);
  });

  it('frase ditada no cartão: no centro, sem corte e sem o resto', () => {
    const d = { background: 'brand', exactTexts: ['Cardápio'], textOnly: true, elements: { logo: 'off', handle: 'off' } };
    const out = composeDesign(d, planDirectives(d, S), copy(), S);
    expect(out).toMatchObject({ layout: 'marca', texts: { title: 'Cardápio' }, placements: { logo: 'off', handle: 'off', title: 'c' } });
    expect(Object.keys(out.texts)).toEqual(['title']);
  });

  it('cartão sem fundo pedido sai escuro; sem logo na conta, o logo some e é dito', () => {
    const d = { elements: { logo: 'c', name: 'bc' } };
    const s = { ...S, hasLogo: false };
    const out = composeDesign(d, planDirectives(d, s), copy(), s);
    expect(out.background).toBe('dark');
    expect(out.placements).toEqual({ name: 'bc' });
    expect(out.notApplied.map((n) => n.key)).toEqual(['elements.logo']);
    expect(out.applied.map((a) => a.key)).toEqual(['elements.name']);
  });

  it('texto exato nas famílias de sempre: título, subtítulo, itens; "mais nada" apaga o resto', () => {
    const d = { exactTexts: ['Fornada nova todo dia às 7h'], textOnly: true };
    const out = composeDesign(d, planDirectives(d, S), copy(), S);
    expect(out.texts).toEqual({ title: 'Fornada nova todo dia às 7h' });
    expect(out.layout).toBe('titulo-destaque');
    const two = { exactTexts: ['Título dito', 'Subtítulo dito'] };
    expect(composeDesign(two, planDirectives(two, S), copy(), S).texts).toEqual({ kicker: 'Dica', title: 'Título dito', sub: 'Subtítulo dito', items: ['a', 'b', 'c'] });
    const list = { exactTexts: ['T', 'S', 'um', 'dois'], textOnly: true };
    expect(composeDesign(list, planDirectives(list, S), copy(), S)).toMatchObject({ layout: 'lista-numerada', texts: { title: 'T', sub: 'S', items: ['um', 'dois'] } });
    const lone = { exactTexts: ['T', 'S', 'um'], textOnly: true };
    const loneOut = composeDesign(lone, planDirectives(lone, S), copy(), S);
    expect(loneOut.texts).toEqual({ title: 'T', sub: 'S' });
    expect(loneOut.notApplied.map((n) => n.key)).toEqual(['exactTexts']);
    expect(usedExactTexts(planDirectives(lone, S))).toEqual(['T', 'S']);
  });

  it('logo no canto e logo fora valem nas famílias de sempre', () => {
    expect(composeDesign({ elements: { logo: 'tr' } }, planDirectives({ elements: { logo: 'tr' } }, S), copy(), S)).toMatchObject({ logoCorner: 'tr', layout: 'lista-numerada' });
    expect(composeDesign({ elements: { logo: 'off' } }, planDirectives({ elements: { logo: 'off' } }, S), copy(), S).logoHidden).toBe(true);
    const noLogo = { ...S, hasLogo: false };
    expect(composeDesign({ elements: { logo: 'tr' } }, planDirectives({ elements: { logo: 'tr' } }, noLogo), copy(), noLogo).notApplied.map((n) => n.key)).toEqual(['elements.logo']);
  });

  it('atmosfera com "sem texto": a foto fica sem título', () => {
    const d = { textOnly: true, elements: { handle: 'bl' } };
    const s = { ...S, kind: 'atmosfera' };
    const out = composeDesign(d, planDirectives(d, s), copy({ kind: 'atmosfera' }), s);
    expect(out).toMatchObject({ layout: 'foto-titulo', texts: { title: '' } });
    expect(out.notApplied.map((n) => n.key)).toEqual(['elements.handle']);
  });

  it('o cartão composto desenha sem achado do revisor de layout, nas duas proporções', () => {
    const c = COMPANIES.aurora;
    const d = { background: 'dark', elements: { logo: 'c', name: 'bc', handle: 'br' } };
    for (const ratio of ['1:1', '4:5']) {
      const out = composeDesign(d, planDirectives(d, S), copy(), S);
      const spec = { kind: 'informativo', ratio, layout: out.layout, texts: out.texts, brand: brandFromProfile(c.profile), logo: c.logo, background: out.background, placements: out.placements, brandName: out.brandName };
      expect(renderPng(spec, { fontDir: FONT_DIR }).issues).toEqual([]);
    }
  });
});

describe('revisores das instruções', () => {
  it('quantidade de itens: reprova com o número pedido; certo, passa', () => {
    const plan = planDirectives({ itemsCount: 3 }, S);
    expect(reviewCount(plan, { texts: { title: 't', items: ['a', 'b', 'c', 'd'] } })).toEqual([{ rule: 'directive_count', detail: '4/3', message: 'A pessoa pediu 3 itens e o texto trouxe 4. Devolva exatamente 3 itens em texts.items.', where: 'image' }]);
    expect(reviewCount(plan, { texts: { title: 't', items: ['a', 'b', 'c'] } })).toEqual([]);
    expect(reviewCount(planDirectives({}, S), { texts: { title: 't' } })).toEqual([]);
    expect(blocking(reviewCount(plan, { texts: { title: 't' } }))).toHaveLength(1);
  });

  it('texto literal ausente e texto a mais com "mais nada" bloqueiam', () => {
    const d = { exactTexts: ['Olá'], textOnly: true };
    const plan = planDirectives(d, S);
    expect(reviewComposed(d, plan, { texts: { title: 'Olá' }, notApplied: [] })).toEqual([]);
    expect(reviewComposed(d, plan, { texts: { title: 'olá  ' }, notApplied: [] })).toEqual([]);
    expect(reviewComposed(d, plan, { texts: { title: 'Outra' }, notApplied: [] }).map((i) => i.rule)).toEqual(['directive_text_missing', 'directive_extra_text']);
    expect(reviewComposed(d, plan, { texts: { title: 'Olá', sub: 'a mais' }, notApplied: [] }).map((i) => i.rule)).toEqual(['directive_extra_text']);
    expect(blocking(reviewComposed(d, plan, { texts: { title: 'x' }, notApplied: [] })).length).toBe(2);
  });

  it('cartão sem texto ditado: nenhum texto de fora; com título pedido, o título é tolerado', () => {
    const d = { background: 'dark', textOnly: true, elements: { logo: 'c' } };
    const plan = planDirectives(d, S);
    expect(reviewComposed(d, plan, { texts: { title: '' }, notApplied: [] })).toEqual([]);
    expect(reviewComposed(d, plan, { texts: { title: 'Frase extra' }, notApplied: [] }).map((i) => i.rule)).toEqual(['directive_extra_text']);
    const withTitle = { background: 'dark', textOnly: true, elements: { title: 'c' } };
    expect(reviewComposed(withTitle, planDirectives(withTitle, S), { texts: { title: 'O título que ele pediu' }, notApplied: [] })).toEqual([]);
  });

  it('descreve cada instrução com a chave que o "não aplicado" usa', () => {
    expect(describeEach({ background: 'light', elements: { logo: 'tl' }, noPhoto: true }).map((x) => x.key)).toEqual(['background', 'elements.logo', 'noPhoto']);
  });
});
