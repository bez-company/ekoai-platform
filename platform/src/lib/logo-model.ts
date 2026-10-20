// logo-model.ts: o que pode ser logo da empresa (SPEC 011 R3): PNG ou SVG, até 2 MB. Puro, sem
// I/O. O tipo vem dos BYTES, nunca do nome nem do Content-Type que o navegador mandou. O PNG é
// conferido chunk a chunk e cortado no IEND (nada escondido depois); o SVG passa por
// svg-sanitize.ts e sai reescrito.

import { sanitizeSvg, SVG_MAX_BYTES } from './svg-sanitize';

export const LOGO_MAX_BYTES = SVG_MAX_BYTES;
export const PNG_MAX_SIDE = 4096;

export type LogoType = 'image/png' | 'image/svg+xml';
export type InspectedLogo = { ok: true; contentType: LogoType; ext: 'png' | 'svg'; bytes: Uint8Array } | { ok: false; error: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const WRONG_FORMAT = 'Use PNG ou SVG de até 2 MB.';

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

export function inspectLogo(bytes: Uint8Array): InspectedLogo {
  if (bytes.length === 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: `O arquivo tem ${(bytes.length / 1048576).toFixed(1).replace('.', ',')} MB. ${WRONG_FORMAT}` };
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return inspectPng(bytes);
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
  return { ok: false, error: `Não reconhecemos este arquivo como PNG nem SVG. ${WRONG_FORMAT}` };
}

// Chave do arquivo no bucket: sempre debaixo da pasta da conta (a constraint do banco exige).
export function logoKey(tenantId: string, id: string, ext: 'png' | 'svg'): string {
  return `tenants/${tenantId}/logo/${id}.${ext}`;
}
