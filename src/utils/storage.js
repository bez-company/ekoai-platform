// storage.js — upload de mídia (PNG dos posts, PDF do carrossel do LinkedIn, vídeo) para o
// Cloud Storage. O bucket é PRIVADO: a URL devolvida aponta para a rota /api/media da plataforma,
// que lê do bucket. É essa URL que o Instagram, o LinkedIn e o X buscam na hora de publicar.
// O nome do objeto leva um UUID, então a URL não se adivinha (ADR 0006, SPEC 010).
//
// Env: STORAGE_BUCKET (nome do bucket) e MEDIA_BASE_URL (ex.: https://app.exemplo/api/media).
// Credencial: a service account do job (ADC); localmente, `gcloud auth application-default login`.

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

export function mediaKeyFor(file) {
  const folder = contentTypeFor(file) === 'application/pdf' ? 'documents' : 'images';
  return `${folder}/${randomUUID()}${path.extname(file).toLowerCase()}`;
}

export function mediaUrlFor(key) {
  const base = process.env.MEDIA_BASE_URL;
  if (!base) throw new Error('MEDIA_BASE_URL é obrigatória (URL da rota /api/media da plataforma). Veja .env.example.');
  return `${base.replace(/\/+$/, '')}/${key}`;
}

function bucket() {
  const name = process.env.STORAGE_BUCKET;
  if (!name) throw new Error('STORAGE_BUCKET é obrigatória para enviar mídia. Veja .env.example.');
  return new Storage().bucket(name);
}

export async function uploadImage(localPath) {
  const key = mediaKeyFor(localPath);
  const url = mediaUrlFor(key);
  await bucket().file(key).save(await readFile(localPath), {
    contentType: contentTypeFor(localPath),
    resumable: false,
  });
  return { url, path: key };
}
