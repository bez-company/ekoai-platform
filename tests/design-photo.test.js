// Publicar foto sem IA (SPEC 017 decisões 5 e 10, BEZ-236): o corte no formato do feed, girando a
// foto do celular pela orientação do EXIF (o resvg não gira sozinho), e o pedido validado na entrada.
import { describe, it, expect } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { createRequire } from 'node:module';
import { cropBox, orientedSize, renderPhoto, isPhotoRatio } from '../platform/src/lib/design/photo.ts';
import { pngSize } from '../platform/src/lib/design/render.ts';
import { parsePhotoPost, parsePhotoCaptionRequest, buildPhotoCaptionPrompt, cleanHashtags } from '../platform/src/lib/photo-post-model.ts';

// PNG 400x200: metade esquerda vermelha, direita azul.
function halves(w = 400, h = 200) {
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, (_, x) => Buffer.from(x < w / 2 ? [255, 0, 0] : [0, 0, 255]))]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

// Lê um pixel do PNG renderizando-o de novo pelo resvg (decodifica sem depender de outra biblioteca).
function pixel(png, width, height, x, y) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
  const px = new Resvg(svg).render().pixels;
  const i = (y * width + x) * 4;
  return [px[i], px[i + 1], px[i + 2]];
}
// O resvg mora nas dependências da plataforma.
const { Resvg } = createRequire(new URL('../platform/package.json', import.meta.url))('@resvg/resvg-js');
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 8);

describe('corte da foto', () => {
  it('o maior retângulo do formato, centrado no foco e sem sair da foto', () => {
    expect(cropBox({ width: 4000, height: 3000 }, '1:1')).toEqual({ x: 500, y: 0, w: 3000, h: 3000 });
    expect(cropBox({ width: 4000, height: 3000 }, '1:1', { x: 0, y: 0.5 })).toMatchObject({ x: 0 });
    expect(cropBox({ width: 4000, height: 3000 }, '1:1', { x: 1, y: 0.5 })).toMatchObject({ x: 1000 });
    const portrait = cropBox({ width: 3000, height: 4000 }, '4:5');
    expect(portrait.w).toBe(3000);
    expect(portrait.h).toBeCloseTo(3750);
    const land = cropBox({ width: 3000, height: 4000 }, '1.91:1', { x: 0.5, y: 0.2 });
    expect(land.w).toBe(3000);
    expect(land.y).toBeGreaterThanOrEqual(0);
  });

  it('orientação de 5 a 8 troca largura e altura', () => {
    expect(orientedSize({ width: 400, height: 200 }, 6)).toEqual({ width: 200, height: 400 });
    expect(orientedSize({ width: 400, height: 200 }, 3)).toEqual({ width: 400, height: 200 });
  });

  it('sai em 1080 de largura na altura de cada formato', () => {
    const bytes = halves();
    for (const [ratio, h] of [['4:5', 1350], ['1:1', 1080], ['1.91:1', 566]]) {
      const out = renderPhoto({ bytes, contentType: 'image/png', width: 400, height: 200, ratio });
      expect(pngSize(out.png), ratio).toEqual({ width: 1080, height: h });
    }
  });

  it('foto deitada (orientação 6) é girada antes do corte: esquerda vira topo', () => {
    const bytes = halves();
    const upright = renderPhoto({ bytes, contentType: 'image/png', width: 400, height: 200, ratio: '1:1' });
    expect(near(pixel(upright.png, 1080, 1080, 100, 540), RED)).toBe(true);
    expect(near(pixel(upright.png, 1080, 1080, 980, 540), BLUE)).toBe(true);
    const rotated = renderPhoto({ bytes, contentType: 'image/png', width: 400, height: 200, orientation: 6, ratio: '1:1' });
    expect(near(pixel(rotated.png, 1080, 1080, 540, 100), RED)).toBe(true);
    expect(near(pixel(rotated.png, 1080, 1080, 540, 980), BLUE)).toBe(true);
  });
});

describe('pedido de publicar foto', () => {
  const ID = '3f8b2c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f';

  it('valida foto, formato, foco, legenda e quando publicar', () => {
    expect(parsePhotoPost({ assetId: ID, caption: ' Bolo saindo do forno ', hashtags: '#Bolo, confeitaria bolo', when: 'now' })).toEqual({
      ok: true,
      value: { assetId: ID, ratio: '4:5', focus: { x: 0.5, y: 0.5 }, caption: 'Bolo saindo do forno', hashtags: ['bolo', 'confeitaria'], when: 'now' },
    });
    expect(parsePhotoPost({ assetId: ID, ratio: '1.91:1', focus: { x: 0.2, y: 0.8 }, caption: 'x', when: 'schedule' })).toMatchObject({ ok: true, value: { ratio: '1.91:1', focus: { x: 0.2, y: 0.8 } } });
    expect(parsePhotoPost({ assetId: 'images/../x', caption: 'x', when: 'now' })).toMatchObject({ ok: false, field: 'assetId' });
    expect(parsePhotoPost({ assetId: ID, ratio: '9:16', caption: 'x', when: 'now' })).toMatchObject({ ok: false, field: 'ratio' });
    expect(parsePhotoPost({ assetId: ID, focus: { x: 2, y: 0 }, caption: 'x', when: 'now' })).toMatchObject({ ok: false, field: 'focus' });
    expect(parsePhotoPost({ assetId: ID, caption: '   ', when: 'now' })).toMatchObject({ ok: false, field: 'caption' });
    expect(parsePhotoPost({ assetId: ID, caption: 'x'.repeat(2201), when: 'now' })).toMatchObject({ ok: false, field: 'caption' });
    expect(parsePhotoPost({ assetId: ID, caption: 'x', when: 'ontem' })).toMatchObject({ ok: false, field: 'when' });
    expect(isPhotoRatio('1.91:1')).toBe(true);
    expect(cleanHashtags(['#Açaí', 'açaí', ''])).toEqual(['açaí']);
  });

  it('pedido da legenda: foto obrigatória, ideia opcional e curta', () => {
    expect(parsePhotoCaptionRequest({ assetId: ID })).toEqual({ ok: true, value: { assetId: ID, idea: null } });
    expect(parsePhotoCaptionRequest({ assetId: ID, idea: '  festa  da   Ana ' })).toEqual({ ok: true, value: { assetId: ID, idea: 'festa da Ana' } });
    expect(parsePhotoCaptionRequest({ assetId: ID, idea: 'x'.repeat(301) })).toMatchObject({ ok: false, field: 'idea' });
    expect(parsePhotoCaptionRequest({})).toMatchObject({ ok: false, field: 'assetId' });
  });

  it('o prompt da legenda leva a empresa, os fatos, a descrição da foto e proíbe inventar', () => {
    const profile = { niche: 'Confeitaria', offering: 'Bolos sob encomenda', audience: 'Famílias', region: 'Marília', ctaDefault: 'whatsapp', bannedWords: ['imperdível'] };
    const prompt = buildPhotoCaptionPrompt({ profile, facts: ['Entrega em Marília'], never: ['Sem glúten'], rules: ['Fale do recheio'], description: 'Bolo de morango na bancada', idea: null });
    expect(prompt).toContain('Confeitaria');
    expect(prompt).toContain('Entrega em Marília');
    expect(prompt).toContain('Nunca afirma: Sem glúten');
    expect(prompt).toContain('Bolo de morango na bancada');
    expect(prompt).toContain('Não invente produto');
    expect(prompt).toContain('chamar no WhatsApp');
  });
});
