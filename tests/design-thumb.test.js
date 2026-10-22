import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderThumb, thumbSize, THUMB_SHORT_SIDE } from '../platform/src/lib/design/thumb.ts';
import { orientationApp1, inspectPhoto } from '../platform/src/lib/media-asset-model.ts';

const req = createRequire(join(import.meta.dirname, '../platform/package.json'));
const jpeg = req('jpeg-js');

// JPEG 640x400: metade esquerda vermelha, direita azul. Com a orientação 6 (celular em pé), a foto
// em pé tem 400x640 e o vermelho fica em cima.
function twoColorJpeg(orientation) {
  const w = 640, h = 400;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    data[i] = x < w / 2 ? 220 : 20; data[i + 1] = 20; data[i + 2] = x < w / 2 ? 20 : 220; data[i + 3] = 255;
  }
  const raw = Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data);
  if (orientation === 1) return raw;
  return Buffer.concat([raw.subarray(0, 2), Buffer.from(orientationApp1(orientation)), raw.subarray(2)]);
}
const pixel = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

describe('miniatura do banco de imagens', () => {
  it('tamanho: lado menor de 480, sem ampliar foto pequena', () => {
    expect(thumbSize({ width: 2000, height: 1000 })).toEqual({ width: 960, height: THUMB_SHORT_SIDE });
    expect(thumbSize({ width: 4032, height: 3024 }, 6)).toEqual({ width: 480, height: 640 });
    expect(thumbSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
  });

  it('foto de celular (orientação 6) sai em pé, com o vermelho em cima', () => {
    const bytes = twoColorJpeg(6);
    const r = inspectPhoto(new Uint8Array(bytes));
    expect(r).toMatchObject({ ok: true, width: 400, height: 640 });
    const out = renderThumb({ bytes, contentType: 'image/jpeg', width: 640, height: 400, orientation: 6 });
    expect([out.width, out.height]).toEqual([400, 640]);
    const img = jpeg.decode(out.jpeg);
    const [rTop, , bTop] = pixel(img, 200, 80);
    const [rBot, , bBot] = pixel(img, 200, 560);
    expect(rTop).toBeGreaterThan(150);
    expect(bTop).toBeLessThan(80);
    expect(bBot).toBeGreaterThan(150);
    expect(rBot).toBeLessThan(80);
  });

  it('é um JPEG bem menor que a original', () => {
    const big = Buffer.alloc(3000 * 2000 * 4, 128);
    for (let i = 0; i < big.length; i += 97) big[i] = (i * 31) % 255; // ruído para não comprimir trivialmente
    const raw = Buffer.from(jpeg.encode({ data: big, width: 3000, height: 2000 }, 92).data);
    const out = renderThumb({ bytes: raw, contentType: 'image/jpeg', width: 3000, height: 2000 });
    expect([out.width, out.height]).toEqual([720, 480]);
    expect(out.jpeg[0]).toBe(0xff);
    expect(out.jpeg.length).toBeLessThan(raw.length / 4);
    expect(out.jpeg.length).toBeLessThan(100 * 1024);
  });
});
