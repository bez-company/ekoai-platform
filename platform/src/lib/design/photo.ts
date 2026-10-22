// photo.ts: a foto pronta no formato do feed (SPEC 017 decisões 5 e 10, BEZ-236). Puro, sem I/O.
// O corte é o maior retângulo do formato que cabe na foto, centrado no ponto de interesse (foco).
// O resvg não aplica a orientação do EXIF, então a foto do celular é girada aqui, antes do corte.

import { Resvg } from '@resvg/resvg-js';
import { WIDTH } from './model';

export const PHOTO_RATIOS = ['4:5', '1:1', '1.91:1'] as const;
export type PhotoRatio = (typeof PHOTO_RATIOS)[number];

// 1080 de largura, como o resto dos posts; 1.91:1 é o mínimo de altura que a API do Instagram aceita.
export const PHOTO_HEIGHT: Record<PhotoRatio, number> = { '4:5': 1350, '1:1': 1080, '1.91:1': 566 };

export type Focus = { x: number; y: number }; // 0 a 1, na foto já girada; 0,5 e 0,5 é o centro
export type Box = { x: number; y: number; w: number; h: number };

export function isPhotoRatio(value: unknown): value is PhotoRatio {
  return typeof value === 'string' && (PHOTO_RATIOS as readonly string[]).includes(value);
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

// Orientação do EXIF (1 a 8): de 5 a 8 a foto fica de lado, então largura e altura trocam.
export function orientedSize(size: { width: number; height: number }, orientation = 1): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

// A transformação que leva os pixels crus para a foto em pé (matriz SVG a b c d e f).
export function orientationMatrix(raw: { width: number; height: number }, orientation = 1): [number, number, number, number, number, number] {
  const { width: w, height: h } = raw;
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, w, 0];
    case 3: return [-1, 0, 0, -1, w, h];
    case 4: return [1, 0, 0, -1, 0, h];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, h, 0];
    case 7: return [0, -1, -1, 0, h, w];
    case 8: return [0, -1, 1, 0, 0, w];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

// O maior retângulo no formato pedido dentro da foto (em pé), com o foco o mais ao centro possível.
export function cropBox(size: { width: number; height: number }, ratio: PhotoRatio, focus: Focus = { x: 0.5, y: 0.5 }): Box {
  const target = WIDTH / PHOTO_HEIGHT[ratio];
  const fx = clamp(Number.isFinite(focus.x) ? focus.x : 0.5, 0, 1);
  const fy = clamp(Number.isFinite(focus.y) ? focus.y : 0.5, 0, 1);
  const wide = size.width / size.height > target;
  const w = wide ? size.height * target : size.width;
  const h = wide ? size.height : size.width / target;
  return { x: clamp(fx * size.width - w / 2, 0, size.width - w), y: clamp(fy * size.height - h / 2, 0, size.height - h), w, h };
}

export type PhotoInput = {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png';
  width: number; // pixels crus do arquivo, sem a orientação
  height: number;
  orientation?: number;
  ratio: PhotoRatio;
  focus?: Focus;
};

export function photoSvg(input: PhotoInput): { svg: string; width: number; height: number; box: Box } {
  const raw = { width: input.width, height: input.height };
  const box = cropBox(orientedSize(raw, input.orientation), input.ratio, input.focus);
  const height = PHOTO_HEIGHT[input.ratio];
  const [a, b, c, d, e, f] = orientationMatrix(raw, input.orientation);
  const href = `data:${input.contentType};base64,${Buffer.from(input.bytes).toString('base64')}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="none">` +
    `<g transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})"><image width="${raw.width}" height="${raw.height}" preserveAspectRatio="none" href="${href}"/></g></svg>`;
  return { svg, width: WIDTH, height, box };
}

// A foto cortada em PNG de 1080 de largura. Mesma entrada, mesmo PNG.
export function renderPhoto(input: PhotoInput): { png: Buffer; width: number; height: number; box: Box } {
  const { svg, width, height, box } = photoSvg(input);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
  return { png: Buffer.from(png), width, height, box };
}
