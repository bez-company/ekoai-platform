import { describe, it, expect } from 'vitest';
import { hasAnythingToApply, parseApplyBody } from '../platform/src/lib/site-read/apply-model.ts';

describe('corpo de aplicar a leitura', () => {
  it('dá forma ao que veio e ignora o que não é do formato', () => {
    const i = parseApplyBody({
      site_url: ' https://doceponto.com.br ', about: { niche: 'Alimentação', offering: ' Bolos ', audience: '', region: 3, extra: 'x' }, voice: { formal: 2, technical: 'alto', serious: 3.5 },
      differentiators: ['a', '', 7, 'b'], pains: 'não é lista', facts: [{ text: 'Fato', category: 'oferta_preco', source_note: 'https://doceponto.com.br/' }, { text: '' }, 'lixo'], logo_url: 'https://doceponto.com.br/logo.png', admin: true,
    });
    expect(i).toEqual({
      siteUrl: 'https://doceponto.com.br',
      about: { niche: 'Alimentação', offering: 'Bolos' },
      voice: { formal: 2, serious: undefined, technical: undefined },
      differentiators: ['a', 'b'],
      pains: [],
      facts: [{ text: 'Fato', category: 'oferta_preco', source_note: 'https://doceponto.com.br/' }],
      logoUrl: 'https://doceponto.com.br/logo.png',
    });
  });

  it('o @ do Instagram do cadastro rápido passa junto com o negócio', () => {
    expect(parseApplyBody({ about: { offering: 'Bolos', instagram_handle: ' @doceponto ' } }).about).toEqual({ offering: 'Bolos', instagram_handle: '@doceponto' });
  });

  it('corpo vazio ou inválido não tem nada para aplicar', () => {
    for (const body of [null, 'x', [], {}, { about: {}, facts: [] }]) expect(hasAnythingToApply(parseApplyBody(body)), JSON.stringify(body)).toBe(false);
    expect(hasAnythingToApply(parseApplyBody({ pains: ['x'] }))).toBe(true);
  });

  it('listas e fatos têm teto de 12', () => {
    const i = parseApplyBody({ differentiators: Array.from({ length: 30 }, (_, k) => `d${k}`), facts: Array.from({ length: 30 }, (_, k) => ({ text: `f${k}` })) });
    expect(i.differentiators).toHaveLength(12);
    expect(i.facts).toHaveLength(12);
  });
});
