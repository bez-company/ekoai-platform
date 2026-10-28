// render.ts: DesignSpec para PNG com o resvg (sem Chromium: roda no Cloud Run como está). O mesmo
// spec gera o mesmo PNG. Devolve também as caixas de texto e os achados do revisor de layout.

import { Resvg } from '@resvg/resvg-js';
import { compose, type Composed } from './families';
import { fontDir, fontFilesFor, DEFAULT_BODY, DEFAULT_HEADING } from './fonts';
import type { DesignSpec } from './model';
import { reviewLayout, type Issue } from './review';
import { sceneBoxes, sceneFonts, sceneSvg } from './scene';
import { sceneContext } from './scene-render';

export type Rendered = Composed & { png: Buffer; issues: Issue[] };

// `width` desenha menor (a prévia do ajuste rápido); as caixas e os achados do revisor são os do tamanho cheio.
export function renderPng(input: DesignSpec, options: { fontDir?: string; width?: number } = {}): Rendered {
  // Logo escondido no ajuste rápido: o layout desenha sem ele.
  const spec = input.logoHidden ? { ...input, logo: null } : input;
  // Com cena (Studio, SPEC 027): o fundo do layout e, por cima, as camadas da pessoa. O revisor confere as caixas das camadas.
  const ctx = input.scene ? sceneContext(input) : null;
  const composed = input.scene && ctx
    ? { svg: sceneSvg(input.scene, ctx), boxes: sceneBoxes(input.scene), overflow: [] as string[], width: ctx.width, height: ctx.height }
    : compose(spec);
  const dir = options.fontDir ?? fontDir();
  const families = [spec.brand.fontHeading, spec.brand.fontBody, DEFAULT_HEADING, DEFAULT_BODY, ...(input.scene ? sceneFonts(input.scene) : [])];
  const resvg = new Resvg(composed.svg, {
    fitTo: { mode: 'width', value: options.width ?? composed.width },
    font: { fontFiles: fontFilesFor(families, dir), loadSystemFonts: false, defaultFontFamily: DEFAULT_BODY },
  });
  const png = resvg.render().asPng();
  return { ...composed, png: Buffer.from(png), issues: reviewLayout(composed.boxes, composed.height, composed.overflow) };
}

// Largura e altura de um PNG, pelo cabeçalho (IHDR).
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
