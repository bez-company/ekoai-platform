import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contraste AA do design system 06 (BEZ-141): todo token de texto sobre todo fundo, nos dois temas, com a
// fórmula de luminância relativa do WCAG 2.x. Token novo de texto ou fundo entra nas listas abaixo.
const CSS = readFileSync(join(import.meta.dirname, '../platform/src/app/globals.css'), 'utf8');
const TEXT = ['fg', 'muted', 'accent-text', 'success', 'warning', 'danger', 'info'];
const BACKGROUNDS = ['page', 'surface', 'raised', 'inset'];
const AA = 4.5;

function theme(selector) {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`tema ${selector} não encontrado em globals.css`);
  const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--c-([a-z-]+):\s*(\d+) (\d+) (\d+);/g)].map(([, k, r, g, b]) => [k, [Number(r), Number(g), Number(b)]]));
}

function luminance([r, g, b]) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('contraste AA do design system 06', () => {
  it('a fórmula bate com os valores de referência do WCAG', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });

  for (const [name, selector] of [['claro', ':root,'], ['escuro', "[data-theme='dark']"]]) {
    it(`tema ${name}: todo texto passa 4,5:1 sobre todo fundo`, () => {
      const t = theme(selector);
      const failures = [];
      for (const fg of TEXT) {
        for (const bg of BACKGROUNDS) {
          if (!t[fg] || !t[bg]) throw new Error(`token --c-${!t[fg] ? fg : bg} ausente no tema ${name}`);
          const r = contrast(t[fg], t[bg]);
          if (r < AA) failures.push(`${fg} sobre ${bg}: ${r.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
