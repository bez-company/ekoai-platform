// A família `marca` (SPEC 020, entrega b): o cartão de marca, fundo liso pela paleta da marca e a grade 3x3. Os
// PNGs vão para /tmp/design-out para conferência visual contra o protótipo validado.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPng, pngSize } from '../platform/src/lib/design/render.ts';
import { compose, markPlacements } from '../platform/src/lib/design/families.ts';
import { brandFromProfile, compatibleLayouts, markBackground, paletteFor, storedDesignOf } from '../platform/src/lib/design/model.ts';
import { applyRule } from '../platform/src/lib/design/rules-model.ts';
import { reviewLayout } from '../platform/src/lib/design/review.ts';
import { contrast } from '../platform/src/lib/design/color.ts';
import { COMPANIES } from '../evals/cases.js';

const FONT_DIR = join(import.meta.dirname, '../platform/fonts');
const OUT = '/tmp/design-out';
mkdirSync(OUT, { recursive: true });

const specFor = (key, extra = {}, ratio = '1:1') => {
  const c = COMPANIES[key];
  return { kind: 'informativo', ratio, layout: 'marca', texts: { title: '' }, brand: brandFromProfile(c.profile), logo: c.logo, visual: null, ...extra };
};
const boxOf = (spec, id) => compose(spec).boxes.find((b) => b.id === id);
const centerX = (b) => b.x + b.w / 2;

// As quatro composições do protótipo validado.
const CASES = {
  apresentacao: specFor('aurora', { background: 'dark', brandName: 'Casa Aurora', placements: { logo: 'c', name: 'bc', handle: 'br' } }),
  palavra: specFor('aurora', { background: 'brand', texts: { title: 'Cardápio' }, placements: { logo: 'off', handle: 'off', title: 'c' } }),
  'logo-nome': specFor('vertice', { background: 'dark', brandName: 'Vértice Engenharia', placements: { logo: 'c', name: 'bc', handle: 'br' } }),
  frase: specFor('sorriso', { background: 'brand', texts: { title: 'Sorrir também é cuidar' }, placements: { title: 'ml' } }),
};

describe('cartão de marca: render', () => {
  it('as quatro composições saem nas duas proporções, sem achado do revisor de layout', () => {
    for (const [name, base] of Object.entries(CASES)) {
      for (const ratio of ['1:1', '4:5']) {
        const out = renderPng({ ...base, ratio }, { fontDir: FONT_DIR });
        writeFileSync(join(OUT, `marca-${name}-${ratio.replace(':', 'x')}.png`), out.png);
        expect(pngSize(out.png), `${name} ${ratio}`).toEqual({ width: 1080, height: ratio === '1:1' ? 1080 : 1350 });
        expect(out.issues, `${name} ${ratio}: ${JSON.stringify(out.issues)}`).toEqual([]);
        expect(out.overflow, `${name} ${ratio}`).toEqual([]);
      }
    }
  });

  it('o mesmo design dá o mesmo PNG; mudar o fundo ou a posição muda o PNG', () => {
    const a = renderPng(CASES.apresentacao, { fontDir: FONT_DIR }).png;
    expect(renderPng(CASES.apresentacao, { fontDir: FONT_DIR }).png.equals(a)).toBe(true);
    expect(renderPng({ ...CASES.apresentacao, background: 'light' }, { fontDir: FONT_DIR }).png.equals(a)).toBe(false);
    expect(renderPng({ ...CASES.apresentacao, placements: { ...CASES.apresentacao.placements, logo: 'tl', name: 'tl' } }, { fontDir: FONT_DIR }).png.equals(a)).toBe(false);
  });

  it('logo no centro com o nome embaixo é uma pilha centrada: nome e @ lidos pelo revisor', () => {
    const spec = CASES.apresentacao;
    const name = boxOf(spec, 'name');
    expect(Math.abs(centerX(name) - 540)).toBeLessThan(2);
    const handle = boxOf(spec, 'handle');
    expect(handle.x + handle.w).toBeCloseTo(1080 - 64, 0); // @ no canto inferior direito
    expect(handle.y).toBeGreaterThan(1080 - 64 - 40);
    // o nome fica no meio da imagem (abaixo do logo grande), nunca colado na margem de baixo
    expect(name.y).toBeGreaterThan(540);
    expect(name.y + name.h).toBeLessThan(1080 - 64 - 60);
    expect(markPlacements(spec)).toEqual({ logo: 'c', handle: 'br', name: 'c' });
  });

  it('a palavra única fica no centro, grande, e "off" tira logo e @', () => {
    const title = boxOf(CASES.palavra, 'title');
    expect(Math.abs(centerX(title) - 540)).toBeLessThan(2);
    expect(Math.abs(title.y + title.h / 2 - 540)).toBeLessThan(4);
    expect(title.size).toBeGreaterThanOrEqual(160);
    expect(compose(CASES.palavra).boxes.map((b) => b.id)).toEqual(['title']);
    expect(markPlacements(CASES.palavra)).toEqual({ title: 'c' });
  });

  it('a frase à esquerda, no meio, alinhada à margem; sem instrução o logo e o @ ficam nos cantos de baixo', () => {
    const title = boxOf(CASES.frase, 'title');
    expect(title.x).toBe(64);
    expect(markPlacements(CASES.frase)).toEqual({ logo: 'bl', handle: 'br', title: 'ml' });
    const bare = specFor('aurora', {});
    expect(markPlacements(bare)).toEqual({ logo: 'bl', handle: 'br' });
    expect(markPlacements(specFor('aurora', { placements: { logo: 'br' } }))).toEqual({ logo: 'br', handle: 'bl' });
    expect(markPlacements({ ...bare, logoCorner: 'tr' })).toEqual({ logo: 'tr', handle: 'br' });
  });

  it('o logo no canto superior direito sai pequeno; no centro, grande', () => {
    const small = compose(specFor('vertice', { placements: { logo: 'tr' } })).svg;
    const big = compose(specFor('vertice', { placements: { logo: 'c' } })).svg;
    const heightOf = (svg) => Number(/<image [^>]*height="(\d+)"/.exec(svg)[1]);
    expect(heightOf(small)).toBe(72);
    expect(heightOf(big)).toBe(Math.round(1080 * 0.3));
    expect(compose(specFor('vertice', { placements: { logo: 'tr' } })).svg).toMatch(/<image [^>]*x="\d+"/);
  });

  it('sem logo cadastrado não há logo para pôr; sem nome nem frase não há texto', () => {
    const spec = specFor('aurora', { logo: null, placements: { logo: 'c' } });
    expect(markPlacements(spec)).toEqual({ handle: 'br' });
    expect(compose(spec).svg).not.toContain('<image');
  });

  it('elementos na mesma célula empilham sem se sobrepor; dois textos grandes demais viram achado, não corte', () => {
    const spec = specFor('aurora', { background: 'dark', brandName: 'Casa Aurora', texts: { title: 'Fornada nova todo dia às 7h' }, placements: { logo: 'c', name: 'c', title: 'c' } });
    const out = renderPng(spec, { fontDir: FONT_DIR });
    expect(out.issues.filter((i) => i.rule === 'overlap')).toEqual([]);
    // a frase encolhe para caber no que sobra da altura, sem invadir o @
    expect(boxOf(spec, 'title').size).toBeLessThan(130);
    const full = (title) => specFor('aurora', { background: 'dark', brandName: 'Casa Aurora', texts: { title }, placements: { logo: 'c', name: 'c', title: 'c' } });
    const tall = renderPng(full('Fornada nova todo dia às 7h com pão quente e café coado'), { fontDir: FONT_DIR });
    expect(tall.issues).toEqual([]);
    // frase longa demais para qualquer tamanho legível vira achado do revisor (nunca texto cortado)
    const huge = renderPng(full('Fornada nova todo dia às 7h com pão quente, café coado na hora, bolo de cenoura com cobertura de chocolate e muito mais para a sua família inteira'), { fontDir: FONT_DIR });
    expect(huge.overflow).toContain('title');
    expect(huge.issues.map((i) => i.rule)).toContain('text_too_long');
  });
});

describe('cartão de marca: fundo e contraste', () => {
  it('dark, brand e light saem só da paleta da marca e o texto lê em todos', () => {
    for (const key of Object.keys(COMPANIES)) {
      const brand = brandFromProfile(COMPANIES[key].profile);
      for (const background of ['dark', 'brand', 'light']) {
        const spec = specFor(key, { background });
        const P = paletteFor(spec);
        expect(P.bg).toBe(markBackground(brand, background));
        expect(contrast(P.title, P.bg), `${key} ${background} título`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(P.sub, P.bg), `${key} ${background} @`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast('#FFFFFF', markBackground(brand, 'dark'))).toBeGreaterThanOrEqual(7);
    }
  });

  it('sem fundo pedido, o padrão é o escuro', () => {
    expect(paletteFor(specFor('aurora', {})).bg).toBe(markBackground(brandFromProfile(COMPANIES.aurora.profile), 'dark'));
  });
});

describe('cartão de marca: guardado e editado', () => {
  it('o design guardado leva fundo, posições e nome; o que não há não entra', () => {
    expect(storedDesignOf(CASES.apresentacao)).toMatchObject({ layout: 'marca', background: 'dark', brandName: 'Casa Aurora', placements: { logo: 'c', name: 'bc', handle: 'br' } });
    const plain = storedDesignOf({ ...CASES.apresentacao, background: undefined, placements: {}, brandName: null });
    expect(Object.keys(plain)).toEqual(['layout', 'texts']);
  });

  it('quem está no cartão de marca continua nele; os outros posts não ganham essa opção', () => {
    const texts = { title: 'x' };
    expect(compatibleLayouts('informativo', texts, false)).toEqual(['titulo-destaque']);
    expect(compatibleLayouts('informativo', texts, false, 'titulo-destaque')).toEqual(['titulo-destaque']);
    expect(compatibleLayouts('informativo', texts, false, 'marca')).toEqual(['titulo-destaque', 'marca']);
    expect(compatibleLayouts('atmosfera', texts, true, 'marca')).toEqual(['foto-titulo', 'foto-janela', 'foto-arco', 'marca']);
  });

  it('a regra da marca não mexe no cartão de marca (o pedido vale mais)', () => {
    const design = storedDesignOf(CASES.apresentacao);
    for (const rule of [{ field: 'layout', scope: 'any', value: 'titulo-destaque' }, { field: 'logoHidden', scope: 'any', value: true }, { field: 'logoCorner', scope: 'any', value: 'tr' }]) {
      expect(applyRule(design, rule, { kind: 'informativo', hasVisual: false })).toBeNull();
    }
  });
});

describe('cartão de marca: grade inteira, sem sobreposição', () => {
  const PLACES = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'];
  const other = (p) => PLACES[(PLACES.indexOf(p) + 4) % PLACES.length];

  it('logo, nome, frase e @ em cada célula, em 4 marcas, 2 proporções e 3 fundos: nada se sobrepõe nem sai da margem', () => {
    const bad = [];
    let count = 0;
    for (const key of Object.keys(COMPANIES)) {
      for (const ratio of ['1:1', '4:5']) {
        for (const background of ['dark', 'brand', 'light']) {
          for (const p of PLACES) {
            const combos = [
              { placements: { logo: p } },
              { placements: { logo: p, handle: other(p) } },
              { placements: { name: p, logo: 'off' }, name: true },
              { placements: { name: p, handle: other(p), logo: 'off' }, name: true },
              { placements: { handle: p, logo: 'off' } },
              { placements: { title: p, logo: 'off', handle: 'off' }, title: 'Fornada nova todo dia às 7h' },
              { placements: { logo: 'c', name: 'bc', handle: p }, name: true },
              { placements: { logo: p, name: p, handle: p === 'br' ? 'bl' : 'br' }, name: true },
              { placements: { logo: other(p), title: p }, title: 'Obra segura' },
            ];
            for (const combo of combos) {
              const c = COMPANIES[key];
              const spec = { kind: 'informativo', ratio, layout: 'marca', texts: { title: combo.title ?? '' }, brand: brandFromProfile(c.profile), logo: c.logo, background, placements: combo.placements, ...(combo.name ? { brandName: c.name } : {}) };
              count += 1;
              const composed = compose(spec);
              const issues = reviewLayout(composed.boxes, composed.height, composed.overflow);
              if (issues.length) bad.push(`${key} ${ratio} ${background} ${JSON.stringify(combo.placements)}: ${issues.map((i) => `${i.rule} ${i.detail}`).join(', ')}`);
            }
          }
        }
      }
    }
    expect(count).toBe(4 * 2 * 3 * 9 * 9);
    expect(bad.slice(0, 12)).toEqual([]);
  });
});
