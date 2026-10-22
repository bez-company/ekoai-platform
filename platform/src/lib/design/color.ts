// color.ts: cor para o motor de render. Puro. Contraste WCAG, mistura e as derivações que a marca
// precisa (tinta, papel, fundo escuro o bastante para texto branco).

export type Hex = string; // #RRGGBB

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && HEX.test(value);
}

export function rgb(hex: Hex): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function toHex([r, g, b]: [number, number, number]): Hex {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

// a + (b - a) * t
export function mix(a: Hex, b: Hex, t: number): Hex {
  const A = rgb(a);
  const B = rgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t) as [number, number, number]);
}

export function luminance(hex: Hex): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Escurece (ou clareia) `color` até `text` ter pelo menos `min` de contraste sobre ela.
export function untilContrast(color: Hex, text: Hex, min: number): Hex {
  if (contrast(color, text) >= min) return color;
  const target: Hex = luminance(text) > 0.4 ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidate = mix(color, target, t);
    if (contrast(candidate, text) >= min) return candidate;
  }
  return target;
}

// Cor de `c` vista através de um véu de `over` com opacidade `alpha`.
export function over(c: Hex, veil: Hex, alpha: number): Hex {
  return mix(c, veil, alpha);
}

export const fmtContrast = (n: number) => `${n.toFixed(1).replace('.', ',')}:1`;
