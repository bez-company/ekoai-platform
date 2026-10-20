// media.ts: leitura de mídia do bucket privado (Cloud Storage). Os jobs gravam em
// `images/<uuid>.png` e `documents/<uuid>.pdf` (src/utils/storage.js) e entregam a URL desta
// plataforma (/api/media/<chave>); o Instagram, o LinkedIn e o X buscam por ela ao publicar.
// A chave leva um UUID, então a URL não se adivinha. Nada fora desse formato é lido.

import { Storage } from '@google-cloud/storage';

const KEY =
  /^(images|documents)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|pdf|mp4)$/;

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
};

export function parseMediaKey(segments: string[]): { key: string; contentType: string } | null {
  const key = segments.join('/');
  if (!KEY.test(key)) return null;
  return { key, contentType: CONTENT_TYPES[key.slice(key.lastIndexOf('.') + 1)] };
}

// "bytes=0-99", "bytes=100-" e "bytes=-500" (os últimos 500). Um intervalo só; fora disso, ignora
// o cabeçalho e devolve o arquivo inteiro.
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

let storage: Storage | null = null;

export function mediaFile(key: string) {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new Error('STORAGE_BUCKET é obrigatória.');
  storage ??= new Storage();
  return storage.bucket(bucket).file(key);
}

export function mediaBucket() {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new Error('STORAGE_BUCKET é obrigatória.');
  storage ??= new Storage();
  return storage.bucket(bucket);
}
