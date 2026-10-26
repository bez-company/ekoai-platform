// generation-carousel.ts: desenha as lâminas de um carrossel (SPEC 023, ADR 0025). Todas saem do mesmo código e da
// mesma marca; só a capa leva o visual (o único que chama o modelo de imagem). Texto que não coube: tira o subtítulo
// da lâmina e tenta uma vez, como no post de uma imagem. Os achados do revisor dizem de qual lâmina são.

import type { CopySlide } from './agents';
import { inSlideAt, slideSpecs } from './design/carousel';
import type { DesignSpec, SlideRole } from './design/model';
import { renderPng } from './design/render';
import { blocking, type Issue } from './design/review';

export type RenderedSlide = { spec: DesignSpec; png: Buffer };
export type RenderedCarousel = { slides: RenderedSlide[]; roles: SlideRole[]; issues: Issue[] };

export function renderCarousel(slides: readonly CopySlide[], common: Parameters<typeof slideSpecs>[1], options: { fontDir?: string } = {}): RenderedCarousel {
  const issues: Issue[] = [];
  const rendered = slideSpecs(slides, common).map((spec, i) => {
    let out = renderPng(spec, options.fontDir ? { fontDir: options.fontDir } : {});
    if (blocking(out.issues).length && spec.texts.sub) {
      spec = { ...spec, texts: { ...spec.texts, sub: undefined } };
      out = renderPng(spec, options.fontDir ? { fontDir: options.fontDir } : {});
    }
    issues.push(...out.issues.map((issue) => inSlideAt(issue, i)));
    return { spec, png: out.png };
  });
  return { slides: rendered, roles: slides.map((s) => s.role), issues };
}
