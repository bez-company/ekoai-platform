// Logo em JPG no render de verdade (BEZ-526): o post sai com a logo desenhada, não só com o fundo da marca. O resvg decodifica pelo tipo
// declarado no data URI, então o tipo precisa ser o dos bytes (image/jpeg). WebP não entra: o resvg 2.6.2 não o desenha (ver logo-model.ts).
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { renderPng, pngSize } from '../platform/src/lib/design/render.ts';
import { brandFromProfile } from '../platform/src/lib/design/model.ts';
import { inspectLogo, rasterSize } from '../platform/src/lib/logo-model.ts';
import { logoDimensions } from '../platform/src/lib/brand-logo-image.ts';
import { JPEG_B64 } from './logo-raster-fixtures.js';

const FONT_DIR = join(import.meta.dirname, '../platform/fonts');
const brand = brandFromProfile({ colorPrimary: '#B83262', colorAccent: '#F2A9C4', fontHeading: 'Playfair Display', fontBody: 'Inter', instagramHandle: '@doceponto' });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const spec = (logo) => ({
  kind: 'informativo', ratio: '1:1', layout: 'titulo-destaque',
  texts: { kicker: 'Encomendas', title: 'Bolo de festa sem pressa', sub: 'A gente avisa quando sair do forno.' }, brand, logo,
});

function logoOf(b64) {
  const inspected = inspectLogo(new Uint8Array(Buffer.from(b64, 'base64')));
  expect(inspected.ok).toBe(true);
  const size = logoDimensions(inspected.bytes, inspected.contentType);
  return { dataUri: `data:${inspected.contentType};base64,${Buffer.from(inspected.bytes).toString('base64')}`, ...size };
}

describe('logo JPG no render', () => {
  it('a medida vem do arquivo (96 por 32), não do chute de 3:1', () => {
    for (const b64 of [JPEG_B64]) {
      const inspected = inspectLogo(new Uint8Array(Buffer.from(b64, 'base64')));
      expect(logoDimensions(inspected.bytes, inspected.contentType)).toEqual({ width: 96, height: 32 });
      expect(rasterSize(inspected.bytes, inspected.contentType)).toEqual({ width: 96, height: 32 });
    }
  });

  it('o post com logo JPG sai no tamanho certo, sem aviso do revisor de layout, e diferente do post sem logo', () => {
    const without = renderPng(spec(null), { fontDir: FONT_DIR });
    for (const [name, b64] of [['jpg', JPEG_B64]]) {
      const out = renderPng(spec(logoOf(b64)), { fontDir: FONT_DIR });
      expect(pngSize(out.png), name).toEqual({ width: 1080, height: 1080 });
      expect(out.issues, `${name}: ${JSON.stringify(out.issues)}`).toEqual([]);
      expect(sha(out.png), name).not.toBe(sha(without.png));
    }
  });
});
