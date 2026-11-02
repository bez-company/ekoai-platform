// logo-model.ts: o que pode ser logo da empresa (SPEC 011 R3, BEZ-526): PNG, SVG ou JPG, até 2 MB. Puro,
// sem I/O. O tipo vem dos BYTES, nunca do nome nem do Content-Type que o navegador mandou. O PNG é
// conferido chunk a chunk e cortado no IEND; o JPG, segmento a segmento, sem EXIF, IPTC nem comentário e
// cortado no EOI; o SVG passa por svg-sanitize.ts e sai reescrito. WebP fica de fora: o resvg do render
// (2.6.2) não o desenha e o post sairia sem a logo, sem erro.

import { sanitizeSvg, SVG_MAX_BYTES } from './svg-sanitize';

export const LOGO_MAX_BYTES = SVG_MAX_BYTES;
export const PNG_MAX_SIDE = 4096;

export type LogoType = 'image/png' | 'image/svg+xml' | 'image/jpeg';
export type LogoExt = 'png' | 'svg' | 'jpg';
export type InspectedLogo = { ok: true; contentType: LogoType; ext: LogoExt; bytes: Uint8Array } | { ok: false; error: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const WRONG_FORMAT = 'Use PNG, SVG ou JPG de até 2 MB.';

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function type4(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

function inspectPng(bytes: Uint8Array): InspectedLogo {
  const bad = (error: string): InspectedLogo => ({ ok: false, error });
  let pos = 8;
  let sawIdat = false;
  let first = true;
  while (pos + 12 <= bytes.length) {
    const len = u32(bytes, pos);
    const type = type4(bytes, pos + 4);
    const end = pos + 12 + len;
    if (len > 0x7fffffff || end > bytes.length) return bad('O arquivo PNG está corrompido ou incompleto. Exporte o logo de novo.');
    if (first) {
      if (type !== 'IHDR' || len !== 13) return bad('O arquivo PNG está corrompido. Exporte o logo de novo.');
      const width = u32(bytes, pos + 8);
      const height = u32(bytes, pos + 12);
      if (width < 1 || height < 1) return bad('O arquivo PNG está corrompido. Exporte o logo de novo.');
      if (width > PNG_MAX_SIDE || height > PNG_MAX_SIDE) return bad(`O PNG tem ${width} por ${height} pixels. Use até ${PNG_MAX_SIDE} pixels de lado.`);
      first = false;
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (!sawIdat) return bad('O arquivo PNG está corrompido. Exporte o logo de novo.');
      return { ok: true, contentType: 'image/png', ext: 'png', bytes: bytes.slice(0, end) };
    }
    pos = end;
  }
  return bad('O arquivo PNG está corrompido ou incompleto. Exporte o logo de novo.');
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 1024)).replace(/^\uFEFF/, '').trimStart();
  return head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--') || head.startsWith('<!DOCTYPE');
}

const sideError = (kind: string, width: number, height: number): string => `O ${kind} tem ${width} por ${height} pixels. Use até ${PNG_MAX_SIDE} pixels de lado.`;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// JPG: percorre os segmentos, guarda o que a imagem precisa (JFIF, perfil de cor, Adobe, tabelas, quadro e varreduras) e solta EXIF, IPTC,
// comentário e os outros APPn. Termina no primeiro EOI: o que vier depois some. Só JPG comum (baseline e progressivo).
function inspectJpeg(bytes: Uint8Array): InspectedLogo {
  const corrupt: InspectedLogo = { ok: false, error: 'O arquivo JPG está corrompido ou incompleto. Exporte o logo de novo.' };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return corrupt;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let pos = 2;
  let sawFrame = false;
  let sawScan = false;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return corrupt;
    while (pos + 1 < bytes.length && bytes[pos + 1] === 0xff) pos++;
    const marker = bytes[pos + 1];
    if (marker === undefined) return corrupt;
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) return corrupt;
      kept.push(bytes.subarray(pos, pos + 2));
      return { ok: true, contentType: 'image/jpeg', ext: 'jpg', bytes: concat(kept) };
    }
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return corrupt;
    if (pos + 4 > bytes.length) return corrupt;
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (len < 2 || pos + 2 + len > bytes.length) return corrupt;
    const segment = bytes.subarray(pos, pos + 2 + len);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (len < 8) return corrupt;
      const height = (segment[5] << 8) | segment[6];
      const width = (segment[7] << 8) | segment[8];
      if (width < 1 || height < 1) return corrupt;
      if (width > PNG_MAX_SIDE || height > PNG_MAX_SIDE) return { ok: false, error: sideError('JPG', width, height) };
      sawFrame = true;
    } else if ([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { ok: false, error: 'Este JPG usa uma compressão sem suporte. Exporte o logo de novo como JPG comum.' };
    }
    const dropped = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee);
    if (!dropped) kept.push(segment);
    pos += 2 + len;
    if (marker === 0xda) {
      sawScan = true;
      const start = pos;
      while (pos + 1 < bytes.length) {
        if (bytes[pos] !== 0xff) pos++;
        else if (bytes[pos + 1] === 0x00 || (bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) pos += 2;
        else if (bytes[pos + 1] === 0xff) pos++;
        else break;
      }
      kept.push(bytes.subarray(start, pos));
    }
  }
  return corrupt;
}

// Largura e altura de um JPG já inspecionado (o render encaixa a logo pela altura sem distorcer). null se não achar.
export function rasterSize(bytes: Uint8Array, contentType: string): { width: number; height: number } | null {
  if (contentType === 'image/jpeg') {
    let pos = 2;
    while (pos + 9 < bytes.length) {
      if (bytes[pos] !== 0xff) return null;
      const marker = bytes[pos + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { height: (bytes[pos + 5] << 8) | bytes[pos + 6], width: (bytes[pos + 7] << 8) | bytes[pos + 8] };
      if (marker === 0xda || marker === 0xd9) return null;
      pos += 2 + ((bytes[pos + 2] << 8) | bytes[pos + 3]);
    }
    return null;
  }
  return null;
}

export function inspectLogo(bytes: Uint8Array): InspectedLogo {
  if (bytes.length === 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: `O arquivo tem ${(bytes.length / 1048576).toFixed(1).replace('.', ',')} MB. ${WRONG_FORMAT}` };
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return inspectPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return inspectJpeg(bytes);
  if (looksLikeSvg(bytes)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, error: 'O SVG precisa estar em UTF-8. Exporte o logo de novo.' };
    }
    const result = sanitizeSvg(text);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, contentType: 'image/svg+xml', ext: 'svg', bytes: new TextEncoder().encode(result.svg) };
  }
  return { ok: false, error: `Não reconhecemos este arquivo como PNG, SVG nem JPG. ${WRONG_FORMAT}` };
}

// Chave do arquivo no bucket: sempre debaixo da pasta da conta (a constraint do banco exige).
export function logoKey(tenantId: string, id: string, ext: LogoExt): string {
  return `tenants/${tenantId}/logo/${id}.${ext}`;
}
