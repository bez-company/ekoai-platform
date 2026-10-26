// logo-blend.ts: o logo some no fundo quando nada nele se lê sobre a cor do fundo (o logo na cor da marca sobre o fundo
// "na cor da marca"; a palavra escura sobre o fundo escuro). Medido no eval. Aqui o logo é desenhado em miniatura e
// cada pixel com tinta é comparado com o fundo; o cartão de marca só põe uma placa clara atrás dele quando quase
// nada contrasta. Um logo com tile escuro e marca clara (o tile some, a marca fica) não ganha placa: ela viraria uma
// moldura branca que ninguém pediu. Puro (só o resvg, sem I/O).

import { Resvg } from '@resvg/resvg-js';
import { contrast, type Hex } from './color';
import type { Logo } from './model';

const SIZE = 48;
export const BLEND_BELOW = 1.6; // abaixo disso uma cor do logo se confunde com o fundo
export const LEGIBLE_SHARE = 0.04; // o logo se lê quando ao menos esta parte da tinta dele contrasta com o fundo

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

// A tinta do logo: cada cor com o peso (área x opacidade) que ela tem na miniatura.
type Ink = { average: Hex; colors: Map<Hex, number>; weight: number };

// Cache por imagem: o mesmo logo é medido uma vez só (a mesma conta gera vários posts e o ajuste rápido redesenha o post).
const CACHE = new Map<string, Ink | null>();
const CACHE_MAX = 32;

function inkOf(logo: Logo): Ink | null {
  if (CACHE.has(logo.dataUri)) return CACHE.get(logo.dataUri) ?? null;
  const ink = measure(logo);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(logo.dataUri, ink);
  return ink;
}

// A cor média do logo (só o que tem tinta), ou null se não deu para ler a imagem.
export function logoAverageColor(logo: Logo): Hex | null {
  return inkOf(logo)?.average ?? null;
}

function measure(logo: Logo): Ink | null {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><image href="${logo.dataUri}" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid meet"/></svg>`;
    const { pixels } = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render();
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    const colors = new Map<Hex, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3] / 255;
      if (a < 0.5) continue;
      r += pixels[i] * a;
      g += pixels[i + 1] * a;
      b += pixels[i + 2] * a;
      weight += a;
      const color = `#${hex(pixels[i])}${hex(pixels[i + 1])}${hex(pixels[i + 2])}`.toUpperCase();
      colors.set(color, (colors.get(color) ?? 0) + a);
    }
    if (weight < SIZE) return null; // quase nada desenhado
    return { average: `#${hex(r / weight)}${hex(g / weight)}${hex(b / weight)}`.toUpperCase(), colors, weight };
  } catch {
    return null;
  }
}

// Verdadeiro quando quase nenhuma parte da tinta do logo contrasta com o fundo: aí ele some e precisa de placa.
// Se o tile some mas a marca dentro dele aparece, o logo se lê e fica sem placa.
export function logoBlendsWith(logo: Logo, bg: Hex): boolean {
  const ink = inkOf(logo);
  if (!ink) return false;
  let visible = 0;
  for (const [color, weight] of ink.colors) if (contrast(color, bg) >= BLEND_BELOW) visible += weight;
  return visible / ink.weight < LEGIBLE_SHARE;
}
