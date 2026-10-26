// slide-edit.ts: o ajuste de uma lâmina do carrossel (SPEC 023, BEZ-312, ADR 0025). Puro. A lâmina é lida como um
// design plano (o mesmo formato do post de uma imagem), então o painel, o parser e o revisor do ajuste rápido valem sem
// mudar; ao gravar, o design plano volta para a lista de lâminas, e a capa continua espelhada no nível de cima.

import { diffDesigns, summarize, type DiffContext, type DiffEntry } from './diff';
import type { Slide, StoredDesign } from './model';

export const slidesOf = (design: StoredDesign): Slide[] | null => (Array.isArray(design.slides) && design.slides.length >= 2 ? design.slides : null);

// O que muda o desenho da lâmina; a chave do PNG não conta (muda a cada redesenho).
const keyOf = (s: Slide) => JSON.stringify([s.layout, s.texts, s.logoCorner ?? null, !!s.logoHidden, s.colors ?? null]);

// A lâmina `n` no formato do post de uma imagem: o que o resto do design guarda (foto, regras) fica igual.
export function flatSlide(design: StoredDesign, n: number): StoredDesign {
  const slides = slidesOf(design);
  const s = slides?.[n];
  if (!slides || !s) return design;
  const { slides: _slides, logoCorner: _c, logoHidden: _h, colors: _col, ...rest } = design;
  return { ...rest, layout: s.layout, texts: s.texts, ...(s.logoCorner ? { logoCorner: s.logoCorner } : {}), ...(s.logoHidden ? { logoHidden: true } : {}), ...(s.colors ? { colors: s.colors } : {}) };
}

// O design plano editado volta para a lâmina `n`. Na capa, o nível de cima acompanha (agenda e publicados leem dele).
export function putSlide(design: StoredDesign, n: number, flat: StoredDesign): StoredDesign {
  const slides = slidesOf(design);
  if (!slides || !slides[n]) return design;
  const old = slides[n];
  const next: Slide = {
    role: old.role,
    layout: flat.layout,
    texts: flat.texts,
    ...(old.pngKey ? { pngKey: old.pngKey } : {}),
    ...(flat.logoCorner ? { logoCorner: flat.logoCorner } : {}),
    ...(flat.logoHidden ? { logoHidden: true } : {}),
    ...(flat.colors && Object.keys(flat.colors).length ? { colors: flat.colors } : {}),
  };
  const list = slides.map((s, i) => (i === n ? next : s));
  if (n !== 0) return { ...design, slides: list };
  const { logoCorner: _c, logoHidden: _h, colors: _col, ...rest } = design;
  return { ...rest, layout: next.layout, texts: next.texts, ...(next.logoCorner ? { logoCorner: next.logoCorner } : {}), ...(next.logoHidden ? { logoHidden: true } : {}), ...(next.colors ? { colors: next.colors } : {}), slides: list };
}

// As lâminas cujo desenho mudou entre duas versões do design.
export function changedSlides(before: StoredDesign, after: StoredDesign): number[] {
  const a = slidesOf(before) ?? [];
  const b = slidesOf(after) ?? [];
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (!a[i] || !b[i] || keyOf(a[i]) !== keyOf(b[i])) out.push(i);
  return out;
}

// O diff por lâmina: os mesmos campos do post de uma imagem, com o prefixo `slides.<n>.` (n a partir de 0).
export function slideDiffs(before: StoredDesign, after: StoredDesign, indices: readonly number[], context: DiffContext): DiffEntry[] {
  return indices.flatMap((i) => diffDesigns(flatSlide(before, i), flatSlide(after, i), { ...context, layout: flatSlide(after, i).layout }).map((e) => ({ ...e, field: `slides.${i}.${e.field}` })));
}

// "Lâmina 2: título alterado". Mais de uma lâmina: quais.
export function slideSummary(before: StoredDesign, after: StoredDesign, indices: readonly number[], context: DiffContext): string {
  if (indices.length === 1) {
    const i = indices[0];
    const text = summarize(diffDesigns(flatSlide(before, i), flatSlide(after, i), context));
    return `Lâmina ${i + 1}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }
  return `${indices.length} lâminas ajustadas (${indices.map((i) => i + 1).join(', ')})`;
}
