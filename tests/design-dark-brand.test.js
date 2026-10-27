// BEZ-368: marca com cor principal escura (grafite, ameixa) usa a própria cor como fundo do post; marca clara segue com o
// papel claro. Antes o grafite da empresa nunca aparecia: o padrão da lista numerada era o papel.
import { describe, it, expect } from 'vitest';
import { brandFromProfile, isDarkBrand, paletteFor } from '../platform/src/lib/design/model.ts';
import { contrast } from '../platform/src/lib/design/color.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';

const profile = (colorPrimary, colorAccent = '#E8522F') => ({ colorPrimary, colorAccent, fontHeading: null, fontBody: null, instagramHandle: 'doceponto' });
const spec = (brand, layout = 'lista-numerada') => ({ kind: 'informativo', ratio: '4:5', layout, texts: { title: 'Três sabores da semana', items: ['Brigadeiro', 'Beijinho', 'Cajuzinho'] }, brand });

describe('fundo do post com a cor da marca', () => {
  it('grafite da empresa (#121315): a lista numerada usa o grafite de fundo e texto branco', () => {
    const brand = brandFromProfile(profile('#121315'));
    expect(isDarkBrand(brand)).toBe(true);
    const p = paletteFor(spec(brand));
    expect(p.bg).toBe(brand.deep);
    expect(p.bg.toUpperCase()).toBe('#121315');
    expect(p.title).toBe('#FFFFFF');
    expect(contrast(p.title, p.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.kicker, p.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('marca clara ou média segue com o papel claro e a tinta escura', () => {
    for (const color of ['#F4B942', '#E8522F', '#B83262']) {
      const brand = brandFromProfile(profile(color));
      expect(isDarkBrand(brand), color).toBe(false);
      const p = paletteFor(spec(brand));
      expect(p.bg, color).toBe(brand.paper);
      expect(p.title, color).toBe(brand.ink);
    }
  });

  it('o fundo pedido no pedido do post continua valendo sobre a marca escura', () => {
    const brand = brandFromProfile(profile('#121315'));
    expect(paletteFor({ ...spec(brand), background: 'light' }).bg).toBe(brand.paper);
  });

  it('renderiza a lista numerada da marca escura sem achado do revisor de layout', () => {
    const out = renderPng(spec(brandFromProfile(profile('#121315'))));
    expect(out.png.length).toBeGreaterThan(5000);
    expect(out.issues).toEqual([]);
  });
});
