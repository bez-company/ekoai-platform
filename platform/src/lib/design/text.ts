// text.ts: quebra de linha e encolhimento sem medir glifos (o render não devolve caixas). Usa o
// fator médio de largura da família (fonts.ts): conservador de propósito, para o texto caber sempre
// e o revisor por regra ter uma caixa honesta para conferir margem e sobreposição.

import { FONTS, type FontFamily } from './fonts';

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxChars) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

export type Fit = { size: number; lines: string[]; lineHeight: number; width: number; height: number; overflow: boolean };

export type FitOptions = { family: FontFamily; maxWidth: number; maxLines: number; start: number; min: number; step?: number; lineHeight?: number; weightFactor?: number };

// Do tamanho inicial para baixo, até caber em `maxLines` dentro de `maxWidth`. `overflow` fica
// verdadeiro quando nem o mínimo resolve: o revisor transforma isso em motivo de recusa.
export function fitText(text: string, o: FitOptions): Fit {
  const factor = FONTS[o.family].width * (o.weightFactor ?? 1);
  const lh = o.lineHeight ?? 1.1;
  const step = o.step ?? 4;
  let size = o.start;
  for (;;) {
    const maxChars = Math.max(4, Math.floor(o.maxWidth / (size * factor)));
    const lines = wrapLines(text, maxChars);
    const fits = lines.length <= o.maxLines && lines.every((l) => l.length <= maxChars);
    if (fits || size - step < o.min) {
      const width = Math.min(o.maxWidth, Math.max(...lines.map((l) => l.length), 0) * size * factor);
      return { size, lines, lineHeight: Math.round(size * lh), width, height: Math.round(lines.length * size * lh), overflow: !fits };
    }
    size -= step;
  }
}

// Uma linha só, sem quebra: largura estimada.
export function textWidth(text: string, family: FontFamily, size: number, weightFactor = 1): number {
  return text.length * size * FONTS[family].width * weightFactor;
}
