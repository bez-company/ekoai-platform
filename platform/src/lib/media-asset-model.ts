// media-asset-model.ts: o banco de imagens da empresa (SPEC 017 decisão 9, BEZ-198). Puro, sem I/O.
// O tipo da foto vem dos BYTES, nunca do nome nem do Content-Type do navegador. Antes de guardar,
// a foto perde os metadados (EXIF com GPS, XMP, comentários, textos do PNG): ela pode ir parar num
// post público. Do EXIF só fica a orientação, reescrita num bloco mínimo, para a foto do celular não
// aparecer deitada. Os limites espelham os `check` da migration 0028.

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_MIN_SIDE = 320;
export const MEDIA_MAX_SIDE = 8192;
export const MEDIA_MAX_PER_UPLOAD = 10;
export const MEDIA_MAX_PER_ACCOUNT = 500;
export const DESCRIPTION_MAX = 400;
// Foto usada volta a ser sugerida depois disso (SPEC 017, decisão 9).
export const REUSE_AFTER_DAYS = 90;

export const MEDIA_TAGS = ['produto', 'equipe', 'bastidor', 'espaco', 'evento', 'cliente', 'outro'] as const;
export type MediaTag = (typeof MEDIA_TAGS)[number];
export const TAG_LABEL: Record<MediaTag, string> = {
  produto: 'Produto',
  equipe: 'Equipe',
  bastidor: 'Bastidor',
  espaco: 'Espaço',
  evento: 'Evento',
  cliente: 'Cliente',
  outro: 'Outro',
};

export type MediaType = 'image/jpeg' | 'image/png';
export type InspectedPhoto =
  | { ok: true; contentType: MediaType; ext: 'jpg' | 'png'; bytes: Uint8Array; width: number; height: number }
  | { ok: false; error: string };

export type MediaAsset = {
  id: string;
  contentType: MediaType;
  byteSize: number;
  width: number;
  height: number;
  originalName: string | null;
  description: string | null;
  tags: MediaTag[];
  hasPeople: boolean | null;
  peopleConsent: boolean;
  describedAt: string | null;
  usedAt: string | null;
  usedPostId: string | null;
  createdAt: string;
};

const WRONG_FORMAT = 'Use foto JPEG ou PNG de até 10 MB.';
const BROKEN = 'A foto está corrompida ou incompleta. Exporte de novo e envie outra vez.';

const u16 = (b: Uint8Array, at: number, le = false) => (le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]);
const u32 = (b: Uint8Array, at: number, le = false) =>
  (le ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3])) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sideError(width: number, height: number): string | null {
  if (width > MEDIA_MAX_SIDE || height > MEDIA_MAX_SIDE) return `A foto tem ${width} por ${height} pixels. Use até ${MEDIA_MAX_SIDE} pixels de lado.`;
  if (width < MEDIA_MIN_SIDE || height < MEDIA_MIN_SIDE) return `A foto tem ${width} por ${height} pixels. Use fotos com pelo menos ${MEDIA_MIN_SIDE} pixels de lado.`;
  return null;
}

// Orientação (tag 0x0112) do EXIF de um APP1. 1 quando não há ou quando o bloco não se entende.
export function exifOrientation(app1: Uint8Array): number {
  if (app1.length < 14 || String.fromCharCode(...app1.slice(0, 4)) !== 'Exif' || app1[4] !== 0 || app1[5] !== 0) return 1;
  const tiff = app1.subarray(6);
  const order = String.fromCharCode(tiff[0], tiff[1]);
  if (order !== 'II' && order !== 'MM') return 1;
  const le = order === 'II';
  if (u16(tiff, 2, le) !== 42) return 1;
  const ifd = u32(tiff, 4, le);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(tiff, ifd, le);
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > tiff.length) return 1;
    if (u16(tiff, at, le) === 0x0112) {
      const value = u16(tiff, at + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

// APP1 com um EXIF de uma tag só: a orientação.
export function orientationApp1(orientation: number): Uint8Array {
  const payload = [
    ...[0x45, 0x78, 0x69, 0x66, 0, 0], // "Exif\0\0"
    ...[0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8], // TIFF big-endian, IFD0 no byte 8
    0, 1, // 1 entrada
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, // 0x0112 SHORT x1
    0, 0, 0, 0, // sem próximo IFD
  ];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 255, ...payload]);
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// APP0 (JFIF), APP2 (perfil de cor ICC) e APP14 (Adobe, define a conversão de cor) mudam como a foto
// aparece; os outros APPn e o COM são metadado.
const KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

function inspectJpeg(bytes: Uint8Array): InspectedPhoto {
  const bad = (error = BROKEN): InspectedPhoto => ({ ok: false, error });
  const kept: Uint8Array[] = [];
  let orientation = 1;
  let width = 0;
  let height = 0;
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return bad();
    while (bytes[pos] === 0xff && pos < bytes.length) pos += 1;
    const marker = bytes[pos];
    pos += 1;
    if (marker === undefined) return bad();
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) return bad();
    if (pos + 2 > bytes.length) return bad();
    const len = u16(bytes, pos);
    const end = pos + len;
    if (len < 2 || end > bytes.length) return bad();
    const segment = bytes.subarray(pos - 2, end);
    const data = bytes.subarray(pos + 2, end);
    if (marker === 0xda) {
      // Início dos dados da imagem: daqui até o fim vai como está.
      if (!width || !height) return bad();
      const sizeError = sideError(width, height);
      if (sizeError) return bad(sizeError);
      const swap = orientation >= 5;
      const exif = orientation === 1 ? [] : [orientationApp1(orientation)];
      const [app0, rest] = [kept.filter((s) => s[1] === 0xe0), kept.filter((s) => s[1] !== 0xe0)];
      const out = concat([new Uint8Array([0xff, 0xd8]), ...app0, ...exif, ...rest, bytes.subarray(pos - 2)]);
      return { ok: true, contentType: 'image/jpeg', ext: 'jpg', bytes: out, width: swap ? height : width, height: swap ? width : height };
    }
    if (SOF.has(marker)) {
      if (data.length < 5) return bad();
      height = u16(data, 1);
      width = u16(data, 3);
      kept.push(segment);
    } else if (marker === 0xe1) {
      if (orientation === 1) orientation = exifOrientation(data);
    } else if (marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && !KEEP_APP.has(marker))) {
      // metadado: fora
    } else {
      kept.push(segment);
    }
    pos = end;
  }
  return bad();
}

// Do PNG ficam só os chunks que desenham a imagem e a cor. Textos (tEXt, iTXt, zTXt), EXIF (eXIf),
// data (tIME) e animação saem; o arquivo termina no IEND.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'pHYs']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function inspectPng(bytes: Uint8Array): InspectedPhoto {
  const bad = (error = BROKEN): InspectedPhoto => ({ ok: false, error });
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  while (pos + 12 <= bytes.length) {
    const len = u32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const end = pos + 12 + len;
    if (len > 0x7fffffff || end > bytes.length) return bad();
    if (pos === 8) {
      if (type !== 'IHDR' || len !== 13) return bad();
      width = u32(bytes, pos + 8);
      height = u32(bytes, pos + 12);
      const sizeError = sideError(width, height);
      if (sizeError) return bad(sizeError);
    }
    if (type === 'IDAT') sawIdat = true;
    if (PNG_KEEP.has(type)) kept.push(bytes.subarray(pos, end));
    if (type === 'IEND') {
      if (!sawIdat) return bad();
      return { ok: true, contentType: 'image/png', ext: 'png', bytes: concat(kept), width, height };
    }
    pos = end;
  }
  return bad();
}

export function inspectPhoto(bytes: Uint8Array): InspectedPhoto {
  if (bytes.length === 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (bytes.length > MEDIA_MAX_BYTES) return { ok: false, error: `A foto tem ${(bytes.length / 1048576).toFixed(1).replace('.', ',')} MB. ${WRONG_FORMAT}` };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return inspectJpeg(bytes);
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return inspectPng(bytes);
  return { ok: false, error: `Não reconhecemos este arquivo como foto. ${WRONG_FORMAT}` };
}

// Chave do arquivo no bucket: sempre debaixo da pasta da conta (a constraint do banco exige).
export function mediaAssetKey(tenantId: string, id: string, ext: 'jpg' | 'png'): string {
  return `tenants/${tenantId}/media/${id}.${ext}`;
}

// O nome que a pessoa deu ao arquivo, só para mostrar: sem pasta, sem controle, até 200 caracteres.
export function cleanFileName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || null;
}

function parseTags(raw: unknown): MediaTag[] | null {
  if (!Array.isArray(raw)) return null;
  const tags = [...new Set(raw.filter((t): t is MediaTag => typeof t === 'string' && (MEDIA_TAGS as readonly string[]).includes(t)))];
  return tags;
}

function cleanDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, DESCRIPTION_MAX) : null;
}

// O que o modelo de visão devolve. Nada aqui é confiável: etiqueta fora da lista sai, texto é cortado.
export type VisionResult = { description: string; tags: MediaTag[]; hasPeople: boolean };

export function parseVisionResult(json: unknown): VisionResult | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const description = cleanDescription(j.description);
  if (!description) return null;
  return { description, tags: (parseTags(j.tags) ?? []).slice(0, 3), hasPeople: j.has_people === true };
}

export function visionPrompt(niche: string | null): string {
  return [
    'Você descreve fotos de uma empresa para um banco de imagens que vai virar posts de Instagram.',
    niche ? `Ramo da empresa: ${niche}.` : '',
    'Responda só com JSON: {"description": string, "tags": string[], "has_people": boolean}.',
    `description: uma ou duas frases em português do Brasil, concretas (o que aparece, cores, ambiente, luz), até ${DESCRIPTION_MAX} caracteres. Não invente marca, preço nem nome de pessoa.`,
    `tags: de 1 a 3, só desta lista: ${MEDIA_TAGS.join(', ')}.`,
    'has_people: true se aparece rosto ou pessoa reconhecível.',
  ].filter(Boolean).join('\n');
}

export type MediaPatch = { description?: string | null; tags?: MediaTag[]; people_consent?: boolean };
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export function parseMediaPatch(body: unknown): Parsed<MediaPatch> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const out: MediaPatch = {};
  if ('description' in b) {
    if (b.description !== null && typeof b.description !== 'string') return { ok: false, error: 'A descrição precisa ser um texto.', field: 'description' };
    if (typeof b.description === 'string' && b.description.trim().length > DESCRIPTION_MAX) return { ok: false, error: `Use até ${DESCRIPTION_MAX} caracteres na descrição.`, field: 'description' };
    out.description = cleanDescription(b.description);
  }
  if ('tags' in b) {
    if (!Array.isArray(b.tags) || b.tags.some((t) => typeof t !== 'string' || !(MEDIA_TAGS as readonly string[]).includes(t))) {
      return { ok: false, error: 'Escolha as etiquetas da lista.', field: 'tags' };
    }
    out.tags = parseTags(b.tags)!;
  }
  if ('people_consent' in b) {
    if (typeof b.people_consent !== 'boolean') return { ok: false, error: 'Diga se há autorização de uso de imagem.', field: 'people_consent' };
    out.people_consent = b.people_consent;
  }
  if (!Object.keys(out).length) return { ok: false, error: 'Nada para alterar.' };
  return { ok: true, value: out };
}

export type MediaFilter = 'all' | 'unused' | 'used';
export type MediaListQuery = { filter: MediaFilter; tag: MediaTag | null; limit: number };

export function parseListQuery(params: URLSearchParams): MediaListQuery {
  const f = params.get('filter');
  const filter: MediaFilter = f === 'unused' || f === 'used' ? f : 'all';
  const t = params.get('tag');
  const tag = t && (MEDIA_TAGS as readonly string[]).includes(t) ? (t as MediaTag) : null;
  const n = Number(params.get('limit'));
  const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 60;
  return { filter, tag, limit };
}

// Pode entrar num post: foto com pessoa só com autorização de uso de imagem.
export function canUseInPost(a: Pick<MediaAsset, 'hasPeople' | 'peopleConsent'>): boolean {
  return a.hasPeople !== true || a.peopleConsent;
}

// O coordenador pode sugerir: pode entrar em post e não foi usada nos últimos 90 dias.
export function isSuggestable(a: Pick<MediaAsset, 'hasPeople' | 'peopleConsent' | 'usedAt'>, now: Date = new Date()): boolean {
  if (!canUseInPost(a)) return false;
  if (!a.usedAt) return true;
  return now.getTime() - new Date(a.usedAt).getTime() >= REUSE_AFTER_DAYS * 86_400_000;
}

export function toMediaAsset(row: Record<string, unknown>): MediaAsset {
  return {
    id: String(row.id),
    contentType: row.content_type as MediaType,
    byteSize: Number(row.byte_size),
    width: Number(row.width),
    height: Number(row.height),
    originalName: (row.original_name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    tags: ((row.tags as string[] | null) ?? []).filter((t): t is MediaTag => (MEDIA_TAGS as readonly string[]).includes(t)),
    hasPeople: (row.has_people as boolean | null) ?? null,
    peopleConsent: row.people_consent === true,
    describedAt: row.described_at ? new Date(row.described_at as string).toISOString() : null,
    usedAt: row.used_at ? new Date(row.used_at as string).toISOString() : null,
    usedPostId: (row.used_post_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}
