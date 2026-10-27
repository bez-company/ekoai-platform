// Qual logo entra no post (SPEC 026): a variação certa para o fundo, a principal quando não há, e o motor desenhando a escolhida.
import { describe, it, expect } from 'vitest';
import { isDarkBackground, logoKindFor, pickLogo } from '../platform/src/lib/design/logo-pick.ts';
import { brandFromProfile } from '../platform/src/lib/design/model.ts';
import { compose } from '../platform/src/lib/design/families.ts';

const img = (name) => ({ dataUri: `data:image/svg+xml;base64,${name}`, width: 3, height: 1 });
const all = { ...img('MAIN'), variants: { dark: img('DARK'), light: img('LIGHT'), symbol: img('SYMBOL') } };

describe('fundo claro ou escuro', () => {
  it('escuro quando o branco o lê melhor que o preto', () => {
    expect(isDarkBackground('#121315')).toBe(true);
    expect(isDarkBackground('#4A2C2A')).toBe(true);
    expect(isDarkBackground('#F7F1EF')).toBe(false);
    expect(isDarkBackground('#FFFFFF')).toBe(false);
  });
});

describe('pickLogo', () => {
  it('sem variações devolve a principal; sem logo, null', () => {
    expect(pickLogo(img('MAIN'), '#121315')).toEqual(img('MAIN'));
    expect(pickLogo(null, '#121315')).toBeNull();
    expect(pickLogo(undefined, '#FFFFFF')).toBeNull();
  });

  it('fundo escuro usa a de fundo escuro; fundo claro, a de fundo claro', () => {
    expect(pickLogo(all, '#121315').dataUri).toContain('DARK');
    expect(pickLogo(all, '#F7F1EF').dataUri).toContain('LIGHT');
  });

  it('o espaço pequeno (lâmina de carrossel) usa o símbolo, em qualquer fundo', () => {
    expect(pickLogo(all, '#121315', true).dataUri).toContain('SYMBOL');
    expect(pickLogo(all, '#FFFFFF', true).dataUri).toContain('SYMBOL');
  });

  it('sem a variação certa cai na principal, nunca em outra errada', () => {
    const onlyDark = { ...img('MAIN'), variants: { dark: img('DARK') } };
    expect(logoKindFor(onlyDark, '#F7F1EF', false)).toBe('main');
    expect(pickLogo(onlyDark, '#F7F1EF').dataUri).toContain('MAIN');
    expect(pickLogo(onlyDark, '#121315', true).dataUri).toContain('DARK');
    const onlySymbol = { ...img('MAIN'), variants: { symbol: img('SYMBOL') } };
    expect(pickLogo(onlySymbol, '#121315', false).dataUri).toContain('MAIN');
  });

  it('o resultado não carrega as variações', () => {
    expect(pickLogo(all, '#121315')).not.toHaveProperty('variants');
  });
});

describe('o motor desenha a escolhida', () => {
  const spec = (primary, layout = 'lista-numerada') => ({
    kind: 'informativo', ratio: '4:5', layout, texts: { title: 'Três sabores', items: ['Brigadeiro', 'Beijinho', 'Cajuzinho'] },
    brand: brandFromProfile({ colorPrimary: primary, colorAccent: '#E8522F', fontHeading: null, fontBody: null, instagramHandle: 'doceponto' }), logo: all,
  });

  it('marca escura: o post de fundo escuro leva a variação para fundo escuro', () => {
    const svg = compose(spec('#121315')).svg;
    expect(svg).toContain('DARK');
    expect(svg).not.toContain('MAIN');
  });

  it('marca clara: o post de fundo claro leva a variação para fundo claro', () => {
    const svg = compose(spec('#F4B942')).svg;
    expect(svg).toContain('LIGHT');
    expect(svg).not.toContain('DARK');
  });

  it('sem variações, o desenho é o de sempre', () => {
    const plain = { ...spec('#121315'), logo: img('MAIN') };
    expect(compose(plain).svg).toContain('MAIN');
  });
});
