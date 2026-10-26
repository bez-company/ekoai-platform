// carousel-view.ts: o carrossel como a tela Aprovar o mostra (SPEC 023, BEZ-311). Puro. Lê da pendência o que a
// geração guardou (uma imagem por lâmina, o título de cada uma, os achados do revisor que dizem "Lâmina n") e devolve
// o que a moldura, a tira de miniaturas e a lista de lâminas precisam.

import type { PendingApproval } from './types';

export type CarouselSlide = { url: string; title: string; role: 'cover' | 'content' | 'cta'; warning: string | null };
export type CarouselView = { slides: CarouselSlide[] };

const isCarousel = (p: Pick<PendingApproval, 'generation'>): boolean => p.generation?.variations?.[0]?.format === 'carousel';

export const SLIDE_LABEL: Record<CarouselSlide['role'], string> = { cover: 'Gancho', content: 'Conteúdo', cta: 'Chamada' };

export const carouselBadge = (n: number): string => `Carrossel · ${n} lâminas`;

// O achado do revisor de uma lâmina vem como "Lâmina 3: ...". Sem número, não é de uma lâmina só.
function warningsBySlide(review: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(review)) return out;
  for (const issue of review) {
    const message = typeof (issue as { message?: unknown })?.message === 'string' ? (issue as { message: string }).message : '';
    const m = /^Lâmina (\d+): (.+)$/s.exec(message);
    if (!m) continue;
    const index = Number(m[1]) - 1;
    if (!out.has(index)) out.set(index, m[2]);
  }
  return out;
}

// null quando o post é de uma imagem só (ou a pendência não tem as lâminas).
export function carouselOf(p: Pick<PendingApproval, 'generation' | 'images' | 'seed'>): CarouselView | null {
  const urls = (p.images ?? []).map((i) => i.url).filter((u): u is string => !!u);
  if (!isCarousel(p) || urls.length < 2) return null;
  const titles = Array.isArray(p.seed?.slide_titles) ? (p.seed!.slide_titles as unknown[]) : [];
  const warnings = warningsBySlide(p.seed?.review);
  return {
    slides: urls.map((url, i) => ({
      url,
      title: typeof titles[i] === 'string' ? (titles[i] as string) : `Lâmina ${i + 1}`,
      role: i === 0 ? 'cover' : i === urls.length - 1 ? 'cta' : 'content',
      warning: warnings.get(i) ?? null,
    })),
  };
}
