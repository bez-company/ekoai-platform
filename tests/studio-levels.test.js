import { describe, it, expect } from 'vitest';
import { AGENT_NODES, AUTO_STYLES, DEFAULT_EFFORT, EFFORTS, IMAGE_QUALITY, LEVELS, STYLES, levelAvailable, fallbackReasonFor, isEffort, isImageQuality, isStyleChoice, kindForStyle, levelOf, stylesFor, usesImage } from '../platform/src/lib/studio/levels.ts';

describe('níveis de qualidade (SPEC 030)', () => {
  it('são três, do mais simples ao mais cuidadoso, e só o Rápido vale sem o job do estúdio', () => {
    expect(EFFORTS).toEqual(['instantaneo', 'refinado', 'autoral']);
    expect(LEVELS.map((l) => l.id)).toEqual([...EFFORTS]);
    expect(LEVELS.map((l) => l.name)).toEqual(['Rápido', 'Refinado', 'Autoral']);
    expect(LEVELS.filter((l) => l.engine === 'quick').map((l) => l.id)).toEqual(['instantaneo']);
    // Sem o job do estúdio só o Rápido vale; com ele, os três.
    expect(LEVELS.filter((l) => levelAvailable(l, false)).map((l) => l.id)).toEqual(['instantaneo']);
    expect(LEVELS.filter((l) => levelAvailable(l, true)).map((l) => l.id)).toEqual(['instantaneo', 'refinado', 'autoral']);
    expect(DEFAULT_EFFORT).toBe('instantaneo');
  });

  it('não carrega preço: o valor fica na fatura, nunca no fluxo do post', () => {
    for (const l of LEVELS) expect(Object.keys(l)).not.toContain('priceCents');
    for (const q of Object.values(IMAGE_QUALITY)) expect(Object.keys(q)).not.toContain('priceCents');
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
    expect(isEffort('pro')).toBe(false);
    expect(isEffort('padrao')).toBe(false);
    expect(levelOf('autoral').extra).toBeUndefined();
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

describe('qualidade da imagem', () => {
  it('reconhece padrao e alta', () => {
    expect(isImageQuality('padrao')).toBe(true);
    expect(isImageQuality('alta')).toBe(true);
    expect(isImageQuality('ultra')).toBe(false);
  });
});

describe('motivo do fallback em uma frase (BEZ-497)', () => {
  it('traduz o motivo técnico para a pessoa', () => {
    expect(fallbackReasonFor('o estúdio não entregou: nota 6.4 abaixo do mínimo 7; nota 6.4 (revise)')).toBe('a peça ficou abaixo da qualidade mínima');
    expect(fallbackReasonFor('o estúdio não entregou: revisor=text_drift palavra trocada; layout=ok')).toBe('o revisor encontrou defeito no texto ou na marca');
    expect(fallbackReasonFor('o estúdio não entregou: layout=safe_margin título')).toBe('a peça ficou com defeito de layout');
    expect(fallbackReasonFor('o estúdio não está disponível agora')).toBe('o estúdio não está disponível agora');
    expect(fallbackReasonFor('Vertex 503')).toBe('o estúdio não conseguiu concluir a peça');
    expect(fallbackReasonFor(null)).toBe('o estúdio não conseguiu concluir a peça');
  });
});
