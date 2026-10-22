import { describe, it, expect } from 'vitest';
import {
  inspectPhoto,
  exifOrientation,
  orientationApp1,
  parseVisionResult,
  parseMediaPatch,
  parseListQuery,
  isSuggestable,
  canUseInPost,
  cleanFileName,
  mediaAssetKey,
  MEDIA_MAX_BYTES,
} from '../platform/src/lib/media-asset-model.ts';

const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const seg = (marker, data) => [0xff, marker, ...be16(data.length + 2), ...data];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// EXIF com orientação e um "GPS" de mentira (texto que não pode sobrar no arquivo).
function exif(orientation, le = false) {
  const w16 = (n) => (le ? [n & 255, (n >> 8) & 255] : be16(n));
  const w32 = (n) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255] : be32(n));
  return [...ascii('Exif'), 0, 0, ...ascii(le ? 'II' : 'MM'), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(orientation), 0, 0, ...w32(0), ...ascii('GPS-22.21-49.94')];
}

function jpeg({ w = 800, h = 600, orientation = 6, le = false } = {}) {
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, exif(orientation, le)),
    ...seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/ <x:xmpmeta>Camera Canon</x:xmpmeta>')),
    ...seg(0xfe, ascii('comentario secreto')),
    ...seg(0xdb, new Array(65).fill(1)),
    ...seg(0xc0, [8, ...be16(h), ...be16(w), 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    1, 2, 3, 0xff, 0x00, 4,
    0xff, 0xd9,
  ]);
}

const chunk = (type, data = []) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
const png = (w = 640, h = 640, extra = []) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]), ...extra, ...chunk('IDAT', [1]), ...chunk('IEND'), ...ascii('lixo depois')]);
const text = (bytes) => new TextDecoder('latin1').decode(bytes);

describe('inspectPhoto: JPEG', () => {
  it('lê o tamanho, gira pela orientação e tira EXIF, XMP e comentário', () => {
    const r = inspectPhoto(jpeg());
    expect(r).toMatchObject({ ok: true, contentType: 'image/jpeg', ext: 'jpg', width: 600, height: 800 });
    const out = text(r.bytes);
    expect(out).not.toContain('GPS');
    expect(out).not.toContain('xmpmeta');
    expect(out).not.toContain('secreto');
    expect(out).toContain('JFIF');
    // a orientação sobrevive num EXIF mínimo, logo depois do APP0
    const app1At = r.bytes.indexOf(0xe1, 2);
    expect(r.bytes[app1At - 1]).toBe(0xff);
    expect(exifOrientation(r.bytes.subarray(app1At + 3))).toBe(6);
    expect(r.bytes.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
  });

  it('EXIF little-endian também; orientação 1 não grava EXIF nenhum', () => {
    expect(inspectPhoto(jpeg({ le: true, orientation: 8 }))).toMatchObject({ ok: true, width: 600, height: 800 });
    const r = inspectPhoto(jpeg({ orientation: 1 }));
    expect(r).toMatchObject({ ok: true, width: 800, height: 600 });
    expect(text(r.bytes)).not.toContain('Exif');
  });

  it('o EXIF mínimo é lido de volta', () => {
    expect(exifOrientation(orientationApp1(3).subarray(4))).toBe(3);
    expect(exifOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });

  it('recusa foto pequena demais, grande demais e arquivo cortado', () => {
    expect(inspectPhoto(jpeg({ w: 200, h: 600 }))).toMatchObject({ ok: false, error: expect.stringMatching(/pelo menos 320/) });
    expect(inspectPhoto(jpeg({ w: 9000, h: 600 }))).toMatchObject({ ok: false, error: expect.stringMatching(/até 8192/) });
    expect(inspectPhoto(jpeg().slice(0, 60))).toMatchObject({ ok: false, error: expect.stringMatching(/corrompida/) });
  });
});

describe('inspectPhoto: PNG e o resto', () => {
  it('PNG fica só com os chunks da imagem e termina no IEND', () => {
    const r = inspectPhoto(png(640, 800, [...chunk('tEXt', ascii('Author\0Ana')), ...chunk('eXIf', ascii('GPS')), ...chunk('sRGB', [0])]));
    expect(r).toMatchObject({ ok: true, contentType: 'image/png', ext: 'png', width: 640, height: 800 });
    const out = text(r.bytes);
    expect(out).not.toContain('Author');
    expect(out).not.toContain('GPS');
    expect(out).toContain('sRGB');
    expect(out.endsWith('IEND\0\0\0\0')).toBe(true);
  });

  it('vazio, grande, SVG ou GIF não passam', () => {
    expect(inspectPhoto(new Uint8Array())).toMatchObject({ ok: false });
    expect(inspectPhoto(new Uint8Array(MEDIA_MAX_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/10 MB/) });
    expect(inspectPhoto(new TextEncoder().encode('<svg/>'))).toMatchObject({ ok: false, error: expect.stringMatching(/JPEG ou PNG/) });
    expect(inspectPhoto(new Uint8Array(ascii('GIF89a......')))).toMatchObject({ ok: false });
  });
});

describe('parsers', () => {
  it('visão: etiqueta fora da lista sai, no máximo 3, sem descrição é null', () => {
    expect(parseVisionResult({ description: '  Bolo de pote   na bancada ', tags: ['produto', 'gato', 'produto', 'equipe', 'evento', 'outro'], has_people: 'sim' }))
      .toEqual({ description: 'Bolo de pote na bancada', tags: ['produto', 'equipe', 'evento'], hasPeople: false });
    expect(parseVisionResult({ tags: ['produto'] })).toBeNull();
    expect(parseVisionResult('texto')).toBeNull();
  });

  it('patch: valida cada campo e exige ao menos um', () => {
    expect(parseMediaPatch({ description: ' ', tags: ['bastidor'], people_consent: true })).toEqual({ ok: true, value: { description: null, tags: ['bastidor'], people_consent: true } });
    expect(parseMediaPatch({ tags: ['gato'] })).toMatchObject({ ok: false, field: 'tags' });
    expect(parseMediaPatch({ people_consent: 'sim' })).toMatchObject({ ok: false, field: 'people_consent' });
    expect(parseMediaPatch({ description: 'x'.repeat(401) })).toMatchObject({ ok: false, field: 'description' });
    expect(parseMediaPatch({ tenant_id: 'outra' })).toMatchObject({ ok: false });
  });

  it('lista: filtro, etiqueta e limite com padrão seguro', () => {
    expect(parseListQuery(new URLSearchParams('filter=unused&tag=produto&limit=10'))).toEqual({ filter: 'unused', tag: 'produto', limit: 10 });
    expect(parseListQuery(new URLSearchParams('filter=x&tag=gato&limit=9999'))).toEqual({ filter: 'all', tag: null, limit: 60 });
  });

  it('nome do arquivo sem pasta nem controle; chave debaixo da conta', () => {
    expect(cleanFileName('../../etc/bolo\u0000.jpg')).toBe('bolo.jpg');
    expect(cleanFileName(5)).toBeNull();
    expect(mediaAssetKey('acme', 'abc', 'jpg')).toBe('tenants/acme/media/abc.jpg');
  });
});

describe('uso da foto', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  it('foto com pessoa só entra em post com autorização', () => {
    expect(canUseInPost({ hasPeople: true, peopleConsent: false })).toBe(false);
    expect(canUseInPost({ hasPeople: true, peopleConsent: true })).toBe(true);
    expect(canUseInPost({ hasPeople: null, peopleConsent: false })).toBe(true);
  });

  it('foto usada volta a ser sugerida depois de 90 dias', () => {
    const base = { hasPeople: false, peopleConsent: false };
    expect(isSuggestable({ ...base, usedAt: null }, now)).toBe(true);
    expect(isSuggestable({ ...base, usedAt: '2026-09-01T12:00:00Z' }, now)).toBe(false);
    expect(isSuggestable({ ...base, usedAt: '2026-07-24T12:00:00Z' }, now)).toBe(true);
    expect(isSuggestable({ hasPeople: true, peopleConsent: false, usedAt: null }, now)).toBe(false);
  });
});
