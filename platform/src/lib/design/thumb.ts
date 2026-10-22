// thumb.ts: a miniatura da foto do banco de imagens (BEZ-253). A grade e o seletor mostram a miniatura;
// o corte e a publicação continuam com a original. O resvg desenha a foto já em pé (aplica a
// orientação do EXIF, que ele ignora) no tamanho da miniatura e o jpeg-js codifica: puro JavaScript,
// sem binário nativo na imagem do Cloud Run.

import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { orientationMatrix, orientedSize } from './photo';

// Lado menor da miniatura: a célula da grade tem até ~240 px e o celular tem densidade 2.
export const THUMB_SHORT_SIDE = 480;
export const THUMB_QUALITY = 72;

export type ThumbInput = { bytes: Uint8Array; contentType: 'image/jpeg' | 'image/png'; width: number; height: number; orientation?: number };

// width e height: as medidas cruas do arquivo (como no corte, photoSource).
export function thumbSize(raw: { width: number; height: number }, orientation = 1): { width: number; height: number } {
  const up = orientedSize(raw, orientation);
  const scale = Math.min(1, THUMB_SHORT_SIDE / Math.min(up.width, up.height));
  return { width: Math.max(1, Math.round(up.width * scale)), height: Math.max(1, Math.round(up.height * scale)) };
}

export function renderThumb(input: ThumbInput): { jpeg: Buffer; width: number; height: number } {
  const raw = { width: input.width, height: input.height };
  const up = orientedSize(raw, input.orientation);
  const size = thumbSize(raw, input.orientation);
  const [a, b, c, d, e, f] = orientationMatrix(raw, input.orientation);
  const href = `data:${input.contentType};base64,${Buffer.from(input.bytes).toString('base64')}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${up.width}" height="${up.height}" viewBox="0 0 ${up.width} ${up.height}">` +
    `<g transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})"><image width="${raw.width}" height="${raw.height}" preserveAspectRatio="none" href="${href}"/></g></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: size.width }, background: '#ffffff', font: { loadSystemFonts: false } }).render();
  const encoded = jpeg.encode({ data: Buffer.from(img.pixels), width: img.width, height: img.height }, THUMB_QUALITY);
  return { jpeg: Buffer.from(encoded.data), width: img.width, height: img.height };
}
