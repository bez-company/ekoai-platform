// render.ts: DesignSpec para PNG com o resvg (sem Chromium: roda no Cloud Run como está). O mesmo
// spec gera o mesmo PNG. Devolve também as caixas de texto e os achados do revisor de layout.

import { Resvg } from '@resvg/resvg-js';
import { compose, type Composed } from './families';
import { fontDir, fontFilesFor, DEFAULT_BODY, DEFAULT_HEADING } from './fonts';
import type { DesignSpec } from './model';
import { reviewLayout, type Issue } from './review';

export type Rendered = Composed & { png: Buffer; issues: Issue[] };

export function renderPng(spec: DesignSpec, options: { fontDir?: string } = {}): Rendered {
  const composed = compose(spec);
  const dir = options.fontDir ?? fontDir();
  const resvg = new Resvg(composed.svg, {
    fitTo: { mode: 'width', value: composed.width },
    font: { fontFiles: fontFilesFor([spec.brand.fontHeading, spec.brand.fontBody, DEFAULT_HEADING, DEFAULT_BODY], dir), loadSystemFonts: false, defaultFontFamily: DEFAULT_BODY },
  });
  const png = resvg.render().asPng();
  return { ...composed, png: Buffer.from(png), issues: reviewLayout(composed.boxes, composed.height, composed.overflow) };
}

// Largura e altura de um PNG, pelo cabeçalho (IHDR).
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
