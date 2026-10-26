// logo-blend.ts: o logo some no fundo quando a cor dominante dele é a do fundo (o quadrado verde do logo de uma clínica
// sobre o fundo verde da marca; o logo na cor da marca sobre o fundo "na cor da marca"). Medido no eval. Aqui o
// logo é desenhado em miniatura e a cor média do que não é transparente vai para a conta de contraste; o cartão de
// marca põe uma placa clara atrás dele quando o contraste é baixo. Puro (só o resvg, sem I/O).

import { Resvg } from '@resvg/resvg-js';
import { contrast, type Hex } from './color';
import type { Logo } from './model';

const SIZE = 48;
export const BLEND_BELOW = 1.6; // abaixo disso o logo se confunde com o fundo

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

// Cache por imagem: o mesmo logo é medido uma vez só (a mesma conta gera vários posts e o ajuste rápido redesenha o post).
const CACHE = new Map<string, Hex | null>();
const CACHE_MAX = 32;

// A cor média do logo (só o que tem tinta), ou null se não deu para ler a imagem.
export function logoAverageColor(logo: Logo): Hex | null {
  if (CACHE.has(logo.dataUri)) return CACHE.get(logo.dataUri) ?? null;
  const color = measure(logo);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(logo.dataUri, color);
  return color;
}

function measure(logo: Logo): Hex | null {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><image href="${logo.dataUri}" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid meet"/></svg>`;
    const { pixels } = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render();
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3] / 255;
      if (a < 0.5) continue;
      r += pixels[i] * a;
      g += pixels[i + 1] * a;
      b += pixels[i + 2] * a;
      weight += a;
    }
    if (weight < SIZE) return null; // quase nada desenhado
    return `#${hex(r / weight)}${hex(g / weight)}${hex(b / weight)}`.toUpperCase();
  } catch {
    return null;
  }
}

export function logoBlendsWith(logo: Logo, bg: Hex): boolean {
  const avg = logoAverageColor(logo);
  return avg !== null && contrast(avg, bg) < BLEND_BELOW;
}
