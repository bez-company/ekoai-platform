// media-view.ts: o que as telas do banco de imagens e do Publicar foto mostram (SPEC 017, BEZ-243 e
// BEZ-252). Puro, sem I/O nem import de Node: entra no bundle do navegador. O corte aqui repete a conta
// de design/photo.ts (que usa o resvg e só roda no servidor) para a prévia mostrar o mesmo recorte
// que vai ser publicado.

import { canUseInPost, type MediaAsset } from './media-asset-model';
import { fmtDate, fmtDateTime } from './format';

export const CAPTION_MAX = 2200;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 10;

export type PickedPhoto = {
  id: string;
  url: string; // a original, para a prévia grande
  thumbUrl: string; // a miniatura (BEZ-253), para grade, seletor e corte
  width: number;
  height: number;
  description: string | null;
  originalName: string | null;
  usedAt: string | null;
  hasPeople: boolean | null;
  peopleConsent: boolean;
};

export const photoUrl = (id: string) => `/api/media-assets/${id}/file`;
export const thumbUrl = (id: string) => `/api/media-assets/${id}/thumb`;

export function toPicked(a: MediaAsset): PickedPhoto {
  return { id: a.id, url: photoUrl(a.id), thumbUrl: thumbUrl(a.id), width: a.width, height: a.height, description: a.description, originalName: a.originalName, usedAt: a.usedAt, hasPeople: a.hasPeople, peopleConsent: a.peopleConsent };
}

export function usedLabel(usedAt: string | null): string {
  return usedAt ? `Usada em ${fmtDate(usedAt).slice(0, 5)}` : 'Não usada';
}

// Por que a foto não pode entrar num post agora (null = pode).
export function blockedReason(p: Pick<PickedPhoto, 'hasPeople' | 'peopleConsent'>): string | null {
  return canUseInPost(p) ? null : 'Mostra pessoas: marque a autorização de uso de imagem no banco de imagens.';
}

export function photoTitle(p: Pick<PickedPhoto, 'originalName' | 'description'>): string {
  return p.originalName ?? p.description ?? 'Foto do banco de imagens';
}

export type MediaFilter = 'all' | 'unused' | 'used';

export function countsOf(assets: Pick<MediaAsset, 'usedAt'>[]): Record<MediaFilter, number> {
  const used = assets.filter((a) => a.usedAt).length;
  return { all: assets.length, unused: assets.length - used, used };
}

export function filterAssets<T extends Pick<MediaAsset, 'usedAt'>>(assets: T[], filter: MediaFilter): T[] {
  if (filter === 'unused') return assets.filter((a) => !a.usedAt);
  if (filter === 'used') return assets.filter((a) => a.usedAt);
  return assets;
}

// O que dá para saber antes de enviar (o servidor confere de novo pelos bytes).
export function precheckFile(file: { name: string; size: number; type: string }): string | null {
  if (file.type && !['image/jpeg', 'image/png'].includes(file.type)) return 'Use foto JPEG ou PNG.';
  if (file.size > UPLOAD_MAX_BYTES) return 'Passa de 10 MB. Use foto de até 10 MB.';
  if (file.size === 0) return 'O arquivo está vazio.';
  return null;
}

// Corte da foto no formato do feed: o maior retângulo do formato que cabe na foto (em pé), com o foco
// o mais ao centro possível. Mesma conta de cropBox em design/photo.ts.
export type PhotoRatio = '4:5' | '1:1' | '1.91:1';
export type Focus = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export const RATIOS: { value: PhotoRatio; label: string }[] = [
  { value: '4:5', label: 'Retrato 4:5' },
  { value: '1:1', label: 'Quadrado 1:1' },
  { value: '1.91:1', label: 'Paisagem 1.91:1' },
];

const TARGET: Record<PhotoRatio, number> = { '4:5': 1080 / 1350, '1:1': 1, '1.91:1': 1080 / 566 };
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function cropBox(size: { width: number; height: number }, ratio: PhotoRatio, focus: Focus): Box {
  const target = TARGET[ratio];
  const wide = size.width / size.height > target;
  const w = wide ? size.height * target : size.width;
  const h = wide ? size.height : size.width / target;
  return { x: clamp(focus.x * size.width - w / 2, 0, size.width - w), y: clamp(focus.y * size.height - h / 2, 0, size.height - h), w, h };
}

// O object-position que faz o object-cover mostrar exatamente o recorte (em porcentagem).
export function objectPositionFor(size: { width: number; height: number }, box: Box): string {
  const px = size.width - box.w > 0.5 ? (box.x / (size.width - box.w)) * 100 : 50;
  const py = size.height - box.h > 0.5 ? (box.y / (size.height - box.h)) * 100 : 50;
  return `${px.toFixed(2)}% ${py.toFixed(2)}%`;
}

export function clampFocus(f: Focus): Focus {
  return { x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1) };
}

// Hashtags digitadas: com ou sem #, separadas por espaço ou vírgula.
export function parseHashtagInput(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((h) => h.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

export function whenLabel(nextSlot: string | null): string {
  return nextSlot ? fmtDateTime(nextSlot) : 'Sem horário livre: entra na fila e sai no primeiro horário que você criar';
}
