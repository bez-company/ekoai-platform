import { describe, it, expect } from 'vitest';
import { TONES, contrast, scaleOf, toneOf, readableOn } from '../platform/src/lib/design/color.ts';

describe('escala de tons da marca (SPEC 033)', () => {
  it('tem 9 tons de 100 a 900 e o 500 é a própria cor', () => {
    const scale = scaleOf('#b83262');
    expect(scale.map((s) => s.tone)).toEqual([...TONES]);
    expect(scale).toHaveLength(9);
    expect(scale.find((s) => s.tone === 500).hex).toBe('#B83262');
    expect(toneOf('#B83262', 500)).toBe('#B83262');
  });

  it('do 100 ao 900 só escurece, e todo tom é #RRGGBB', () => {
    for (const hex of ['#B83262', '#2F7D6B', '#F4C95D', '#1F1F1F']) {
      const scale = scaleOf(hex);
      for (const s of scale) expect(s.hex).toMatch(/^#[0-9A-F]{6}$/);
      const onWhite = scale.map((s) => contrast(s.hex, '#FFFFFF'));
      for (let i = 1; i < onWhite.length; i++) expect(onWhite[i], `${hex} tom ${scale[i].tone}`).toBeGreaterThanOrEqual(onWhite[i - 1]);
    }
  });

  it('o 100 é um fundo claro e o 900 um fundo escuro, para texto de contraste legível', () => {
    const scale = scaleOf('#B83262');
    expect(contrast(scale[0].hex, '#18181B')).toBeGreaterThanOrEqual(7);
    expect(contrast(scale[8].hex, '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });

  it('readableOn escolhe branco sobre escuro e quase preto sobre claro', () => {
    expect(readableOn('#4A2C2A')).toBe('#FFFFFF');
    expect(readableOn('#F4C95D')).toBe('#18181B');
  });
});
