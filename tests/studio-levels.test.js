import { describe, it, expect } from 'vitest';
import { AGENT_NODES, AUTO_STYLES, DEFAULT_EFFORT, EFFORTS, IMAGE_QUALITY, LEVELS, STYLES, brl, estimate, isEffort, isImageQuality, isStyleChoice, kindForStyle, levelOf, stylesFor, usesImage } from '../platform/src/lib/studio/levels.ts';

describe('níveis de esforço (SPEC 030)', () => {
  it('são cinco, do mais barato ao mais caro, e só o Instantâneo gera na F1', () => {
    expect(EFFORTS).toEqual(['instantaneo', 'padrao', 'refinado', 'autoral', 'pro']);
    expect(LEVELS.map((l) => l.id)).toEqual([...EFFORTS]);
    const prices = LEVELS.map((l) => l.priceCents);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(LEVELS.filter((l) => l.available).map((l) => l.id)).toEqual(['instantaneo']);
    expect(DEFAULT_EFFORT).toBe('instantaneo');
  });

  it('cada nível acende agentes que existem, e o esforço cresce', () => {
    for (const l of LEVELS) expect(l.lit.every((i) => Number.isInteger(i) && i >= 0 && i < AGENT_NODES.length)).toBe(true);
    const counts = LEVELS.map((l) => l.lit.length);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it('reconhece o valor válido e recusa o resto', () => {
    expect(isEffort('refinado')).toBe(true);
    expect(isEffort('turbo')).toBe(false);
    expect(isEffort(null)).toBe(false);
    expect(levelOf('pro').extra).toBe('3 opções');
  });
});

describe('estilos e tipo do post', () => {
  it('tem 15 estilos com id único', () => {
    expect(STYLES).toHaveLength(15);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(15);
  });

  it('o filtro separa minimalista de com imagem, e o "opcional" aparece nos dois', () => {
    const min = stylesFor('minimalista');
    const img = stylesFor('imagem');
    expect(min.every((s) => s.image !== 'required')).toBe(true);
    expect(img.every((s) => s.image !== 'none')).toBe(true);
    expect(stylesFor('todos')).toHaveLength(15);
    const optional = STYLES.filter((s) => s.image === 'optional');
    expect(optional.length).toBeGreaterThan(0);
    for (const s of optional) expect([min.includes(s), img.includes(s)]).toEqual([true, true]);
  });

  it('aceita os estilos automáticos e os ids da vitrine, e recusa o desconhecido', () => {
    for (const a of AUTO_STYLES) expect(isStyleChoice(a)).toBe(true);
    expect(isStyleChoice('cartaz-tipografico')).toBe(true);
    expect(isStyleChoice('cartaz-feio')).toBe(false);
    expect(isStyleChoice(42)).toBe(false);
  });

  it('o estilo decide se há imagem e qual tipo o motor atual recebe', () => {
    expect(usesImage('auto')).toBe('maybe');
    expect(usesImage('auto-minimalista')).toBe('no');
    expect(usesImage('auto-imagem')).toBe('yes');
    expect(usesImage('surreal-fotografico')).toBe('yes');
    expect(usesImage('cartaz-tipografico')).toBe('no');
    expect(usesImage('citacao-grande')).toBe('maybe');
    expect(kindForStyle('auto-minimalista')).toBe('informativo');
    expect(kindForStyle('objeto-heroi')).toBe('atmosfera');
    expect(kindForStyle('auto')).toBeNull();
  });
});

describe('estimativa de preço', () => {
  it('sem imagem vale o preço do nível', () => {
    expect(estimate({ effort: 'refinado', style: 'cartaz-tipografico', imageQuality: null })).toEqual({ priceCents: 500, maxCents: null, image: 'no', time: 'cerca de 10 minutos' });
  });

  it('com imagem soma a qualidade escolhida', () => {
    expect(estimate({ effort: 'autoral', style: 'surreal-fotografico', imageQuality: 'alta' }).priceCents).toBe(800 + IMAGE_QUALITY.alta.priceCents);
    expect(estimate({ effort: 'autoral', style: 'auto-imagem', imageQuality: 'padrao' }).priceCents).toBe(800 + IMAGE_QUALITY.padrao.priceCents);
  });

  it('quando a Ekoai escolhe entre todos, mostra o piso e o teto', () => {
    expect(estimate({ effort: 'refinado', style: 'auto', imageQuality: 'padrao' })).toMatchObject({ priceCents: 500, maxCents: 560, image: 'maybe' });
  });

  it('formata em reais com vírgula', () => {
    expect(brl(560)).toBe('R$ 5,60');
    expect(brl(50)).toBe('R$ 0,50');
    expect(isImageQuality('alta')).toBe(true);
    expect(isImageQuality('ultra')).toBe(false);
  });
});
