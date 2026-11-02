// logo-upload.ts: o que entra como logo no envio (BEZ-527). Em volta do `inspectLogo` (puro) fica a conversão de WebP: o render dos posts
// comuns (resvg) não desenha WebP e o post sairia sem a logo, sem erro, então o WebP vira PNG já no envio (e o resto do sistema só vê PNG,
// SVG ou JPG). A conversão tira metadados, recusa WebP animado e limita os pixels antes de decodificar.

import { PNG_MAX_SIDE, WRONG_FORMAT, inspectLogo, type InspectedLogo } from './logo-model';

const WEBP_CORRUPT = 'O arquivo WebP está corrompido ou incompleto. Exporte o logo de novo.';

const ascii = (b: Uint8Array, at: number): string => String.fromCharCode(...b.subarray(at, at + 4));
export const looksLikeWebp = (b: Uint8Array): boolean => b.length >= 20 && ascii(b, 0) === 'RIFF' && ascii(b, 8) === 'WEBP';

// Animação no WebP: a flag do VP8X ou os chunks ANIM e ANMF. Lido antes de decodificar.
function animated(b: Uint8Array): boolean {
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = ascii(b, pos);
    const len = (b[pos + 4] | (b[pos + 5] << 8) | (b[pos + 6] << 16) | (b[pos + 7] << 24)) >>> 0;
    if (id === 'ANIM' || id === 'ANMF' || (id === 'VP8X' && (b[pos + 8] & 0x02) !== 0)) return true;
    pos += 8 + len + (len & 1);
  }
  return false;
}

export async function inspectUploadedLogo(bytes: Uint8Array): Promise<InspectedLogo> {
  if (!looksLikeWebp(bytes)) return inspectLogo(bytes);
  if (animated(bytes)) return { ok: false, error: 'O WebP é animado. Use uma imagem parada.' };
  try {
    const { default: sharp } = await import('sharp');
    const png = await sharp(Buffer.from(bytes), { limitInputPixels: PNG_MAX_SIDE * PNG_MAX_SIDE, failOn: 'error' }).png().toBuffer();
    return inspectLogo(new Uint8Array(png));
  } catch (e) {
    if (e instanceof Error && /pixel limit/i.test(e.message)) return { ok: false, error: `O WebP passa de ${PNG_MAX_SIDE} pixels de lado. Use uma imagem menor.` };
    return { ok: false, error: WEBP_CORRUPT };
  }
}

export { WRONG_FORMAT };
