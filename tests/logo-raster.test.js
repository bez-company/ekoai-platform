import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/logo-model.ts';
import { JPEG_B64 } from './logo-raster-fixtures.js';

const JPEG = new Uint8Array(Buffer.from(JPEG_B64, 'base64'));
const text = (s) => [...new TextEncoder().encode(s)];
const has = (bytes, s) => Buffer.from(bytes).includes(s);

// Segmento JPG: FF, marcador, tamanho (inclui os 2 bytes do tamanho) e dados.
const segment = (marker, data) => [0xff, marker, ...[(data.length + 2) >> 8, (data.length + 2) & 255], ...data];
const withAfterSoi = (bytes, extra) => new Uint8Array([...bytes.slice(0, 2), ...extra, ...bytes.slice(2)]);

describe('JPG', () => {
  it('um JPG de verdade é aceito, com o tipo lido dos bytes, e o tamanho sai certo', () => {
    const r = m.inspectLogo(JPEG);
    expect(r).toMatchObject({ ok: true, contentType: 'image/jpeg', ext: 'jpg' });
    expect([r.bytes[0], r.bytes[1], r.bytes.at(-2), r.bytes.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(m.rasterSize(r.bytes, 'image/jpeg')).toEqual({ width: 96, height: 32 });
  });

  it('EXIF, IPTC, comentário e lixo depois do fim somem; a imagem continua a mesma', () => {
    const dirty = new Uint8Array([
      ...withAfterSoi(JPEG, [...segment(0xe1, [...text('Exif\0\0'), ...text('GPS-SECRETO')]), ...segment(0xed, text('IPTC-SECRETO')), ...segment(0xfe, text('COMENTARIO-SECRETO'))]),
      ...text('LIXO-DEPOIS-DO-FIM'),
    ]);
    expect(has(dirty, 'GPS-SECRETO')).toBe(true);
    const r = m.inspectLogo(dirty);
    expect(r.ok).toBe(true);
    for (const secret of ['GPS-SECRETO', 'IPTC-SECRETO', 'COMENTARIO-SECRETO', 'LIXO-DEPOIS-DO-FIM']) expect(has(r.bytes, secret), secret).toBe(false);
    expect(r.bytes).toEqual(m.inspectLogo(JPEG).bytes);
  });

  it('perfil de cor (APP2) e o marcador Adobe (APP14) ficam: sem eles a cor muda', () => {
    const icc = segment(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 9, 9]);
    const adobe = segment(0xee, [...text('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
    const r = m.inspectLogo(withAfterSoi(JPEG, [...icc, ...adobe]));
    expect(r.ok).toBe(true);
    expect(has(r.bytes, 'ICC_PROFILE')).toBe(true);
    expect(has(r.bytes, 'Adobe')).toBe(true);
  });

  it('arquivo cortado, sem quadro, sem fim ou que só começa como JPG é recusado com a mensagem de arquivo corrompido', () => {
    const bad = [JPEG.slice(0, 60), JPEG.slice(0, JPEG.length - 2), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00])];
    for (const bytes of bad) {
      const r = m.inspectLogo(bytes);
      expect(r.ok, String(bytes.length)).toBe(false);
      expect(r.error).toMatch(/JPG está corrompido|Não reconhecemos/);
    }
  });

  it('lado maior que 4096 pixels e compressão sem suporte são recusados', () => {
    const at = Buffer.from(JPEG).indexOf(Buffer.from([0xff, 0xc0]));
    const big = new Uint8Array(JPEG);
    big[at + 7] = 0x13; // largura 0x1388 = 5000
    big[at + 8] = 0x88;
    expect(m.inspectLogo(big).error).toBe('O JPG tem 5000 por 32 pixels. Use até 4096 pixels de lado.');
    const arithmetic = new Uint8Array(JPEG);
    arithmetic[at + 1] = 0xc9;
    expect(m.inspectLogo(arithmetic).error).toMatch(/compressão sem suporte/);
  });
});

describe('o que continua recusado', () => {
  it('GIF, PDF, HEIC, WebP e texto qualquer', () => {
    for (const head of ['GIF89a', '%PDF-1.7', 'ftypheic', 'RIFF\0\0\0\0WEBPVP8 ', 'qualquer coisa']) {
      const r = m.inspectLogo(new Uint8Array([...text(head), 0, 0, 0, 0]));
      expect(r.ok, head).toBe(false);
      expect(r.error).toMatch(/Não reconhecemos este arquivo como PNG, SVG nem JPG/);
    }
  });

  it('a chave no armazenamento leva a extensão do tipo', () => {
    expect(m.logoKey('acme', 'abc', 'jpg')).toBe('tenants/acme/logo/abc.jpg');
  });
});
