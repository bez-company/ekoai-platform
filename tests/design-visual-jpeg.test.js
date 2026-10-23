// O modelo de imagem devolve JPEG ou PNG e o visual vai sempre para `.png`. O resvg decodifica pelo tipo
// declarado no data URI: JPEG rotulado como PNG sumia do render e o post saía só com o fundo da marca.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { brandFromProfile, imageDataUri } from '../platform/src/lib/design/model.ts';

const req = createRequire(join(import.meta.dirname, '../platform/package.json'));
const jpeg = req('jpeg-js');
const { Resvg } = req('@resvg/resvg-js');
const FONT_DIR = join(import.meta.dirname, '../platform/fonts');

// JPEG 1080x1350 verde puro.
function greenJpeg() {
  const w = 1080, h = 1350;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([30, 160, 60, 255], i);
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, 90).data);
}

// Cor do pixel (x, y) do PNG renderizado.
function pixel(png, x, y) {
  const img = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><image width="1080" height="1350" href="data:image/png;base64,${Buffer.from(png).toString('base64')}"/></svg>`).render();
  const i = (y * img.width + x) * 4;
  return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
}

const brand = brandFromProfile({ colorPrimary: '#1F2937', colorAccent: '#C2410C', fontHeading: null, fontBody: null, instagramHandle: null });
const spec = (visual) => ({ kind: 'atmosfera', ratio: '4:5', layout: 'foto-titulo', texts: { kicker: 'Seu campo de ideias', title: 'Da sua cabeça para o mundo digital' }, brand, logo: null, visual });

describe('visual do modelo de imagem', () => {
  it('lê o tipo dos bytes, não do nome', () => {
    expect(imageDataUri(greenJpeg())).toMatch(/^data:image\/jpeg;base64,/);
    expect(imageDataUri(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatch(/^data:image\/png;base64,/);
    expect(imageDataUri(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]))).toMatch(/^data:image\/webp;base64,/);
  });

  it('o JPEG entra no post (topo sem véu fica verde, não o fundo da marca)', () => {
    const out = renderPng(spec({ dataUri: imageDataUri(greenJpeg()) }), { fontDir: FONT_DIR });
    const [r, g, b] = pixel(out.png, 540, 100);
    expect(g).toBeGreaterThan(r + 60);
    expect(g).toBeGreaterThan(b + 60);
  });
});
