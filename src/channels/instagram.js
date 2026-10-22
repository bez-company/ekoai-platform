// instagram.js — publica post (single image ou carousel) via Instagram Business Login API.
// Chamado por: src/metrics.js e src/refresh-tokens.js (a publicação mora na plataforma). Docs: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
//
// Fluxo:
//   1. POST /{ig-user-id}/media → cria container (image_url ou children pra carousel)
//   2. POST /{ig-user-id}/media_publish → publica container
//
// Limitação: image_url precisa ser URL PÚBLICA. Em produção, fazer upload pra
// CDN/S3/imgur antes. Por enquanto suportamos modo dry-run + assumimos URL pública.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { withRetry } from '../utils/retry.js';

const GRAPH_VERSION = 'v21.0';
const API_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

function token() {
  const t = process.env.IG_ACCESS_TOKEN;
  if (!t) throw new Error('IG_ACCESS_TOKEN ausente');
  return t;
}

function accountId() {
  const id = process.env.IG_BUSINESS_ACCOUNT_ID;
  if (!id) throw new Error('IG_BUSINESS_ACCOUNT_ID ausente');
  return id;
}

// retry:false no publish final (media_publish) — re-tentar após sucesso com
// resposta perdida geraria post duplicado. Criação de container/status é seguro.
async function apiPost(endpoint, params, { retry = true } = {}) {
  const run = async () => {
    const url = new URL(`${API_BASE}${endpoint}`);
    const form = new URLSearchParams({ ...params, access_token: token() });
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`IG API ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };
  return retry ? withRetry(run, { label: `IG ${endpoint}` }) : run();
}

async function waitContainerReady(containerId, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = new URL(`${API_BASE}/${containerId}`);
    url.searchParams.set('fields', 'status_code');
    url.searchParams.set('access_token', token());
    const res = await fetch(url);
    if (!res.ok) throw new Error(`IG status check ${res.status}: ${await res.text()}`);
    const { status_code } = await res.json();
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} status=${status_code}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} não ficou pronto em ${timeoutMs}ms`);
}

export async function publishSingle({ imageUrl, caption, dryRun = false }) {
  if (dryRun) {
    return { id: 'mock_ig_post_id', dryRun: true, channel: 'instagram', imageUrl, captionLength: caption?.length || 0 };
  }
  if (!imageUrl) throw new Error('imageUrl obrigatório (precisa ser URL pública)');

  const container = await apiPost(`/${accountId()}/media`, {
    image_url: imageUrl,
    caption: caption || '',
  });

  await waitContainerReady(container.id);

  const published = await apiPost(`/${accountId()}/media_publish`, {
    creation_id: container.id,
  }, { retry: false });

  return { id: published.id, channel: 'instagram' };
}

export async function publishCarousel({ imageUrls, caption, dryRun = false }) {
  if (dryRun) {
    return { id: 'mock_ig_carousel_id', dryRun: true, channel: 'instagram', slides: imageUrls.length };
  }
  if (!imageUrls || imageUrls.length < 2) throw new Error('Carousel precisa 2+ imagens');
  if (imageUrls.length > 10) throw new Error('Carousel suporta no máximo 10 slides');

  const childIds = [];
  for (const url of imageUrls) {
    const child = await apiPost(`/${accountId()}/media`, {
      image_url: url,
      is_carousel_item: 'true',
    });
    childIds.push(child.id);
  }

  for (const id of childIds) await waitContainerReady(id);

  const container = await apiPost(`/${accountId()}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption || '',
  });

  await waitContainerReady(container.id);

  const published = await apiPost(`/${accountId()}/media_publish`, {
    creation_id: container.id,
  }, { retry: false });

  return { id: published.id, channel: 'instagram', slides: imageUrls.length };
}

// Publica um Reel. videoUrl precisa ser URL pública (mp4). O processamento de
// vídeo demora mais que imagem — timeout maior no polling. media_publish sem retry.
// NOTA: a renderização do vídeo (TTS + ffmpeg/Remotion) é etapa anterior, fora
// deste módulo — aqui só publicamos o mp4 já pronto.
export async function publishReel({ videoUrl, caption, coverUrl, dryRun = false }) {
  if (dryRun) {
    return { id: 'mock_ig_reel_id', dryRun: true, channel: 'instagram', kind: 'reel', videoUrl };
  }
  if (!videoUrl) throw new Error('videoUrl obrigatório (URL pública do mp4)');

  const params = { media_type: 'REELS', video_url: videoUrl, caption: caption || '' };
  if (coverUrl) params.cover_url = coverUrl;
  const container = await apiPost(`/${accountId()}/media`, params);

  await waitContainerReady(container.id, { timeoutMs: 180000, intervalMs: 5000 }); // vídeo: até 3min

  const published = await apiPost(`/${accountId()}/media_publish`, {
    creation_id: container.id,
  }, { retry: false });

  return { id: published.id, channel: 'instagram', kind: 'reel' };
}

// Coleta engajamento de um post publicado. Combina campos diretos (like_count,
// comments_count) com insights (reach, saved). Best-effort: métrica indisponível
// vira null em vez de quebrar a coleta inteira.
export async function getInsights(mediaId) {
  if (!mediaId) return null;
  const out = { likes: null, comments: null, reach: null, saved: null };

  try {
    const fieldsUrl = new URL(`${API_BASE}/${mediaId}`);
    fieldsUrl.searchParams.set('fields', 'like_count,comments_count');
    fieldsUrl.searchParams.set('access_token', token());
    const fieldsRes = await fetch(fieldsUrl);
    if (fieldsRes.ok) {
      const json = await fieldsRes.json();
      out.likes = json.like_count ?? null;
      out.comments = json.comments_count ?? null;
    }
  } catch (_) { /* mantém null */ }

  try {
    const insUrl = new URL(`${API_BASE}/${mediaId}/insights`);
    insUrl.searchParams.set('metric', 'reach,saved');
    insUrl.searchParams.set('access_token', token());
    const insRes = await fetch(insUrl);
    if (insRes.ok) {
      const { data = [] } = await insRes.json();
      for (const m of data) {
        const value = m.values?.[0]?.value ?? m.total_value?.value ?? null;
        if (m.name === 'reach') out.reach = value;
        if (m.name === 'saved') out.saved = value;
      }
    }
  } catch (_) { /* mantém null */ }

  return out;
}

// A renovação do token e a checagem de saúde agora são da plataforma, por conta conectada
// (platform/src/lib/instagram-refresh.ts, SPEC 011 R5.3). Este módulo só lê métricas com o token do ambiente.

// TODO: upload de imagem local pra storage temporário público (S3, imgur, etc).
// Por enquanto consumidor precisa subir e passar URL pública.
export async function uploadImage(localPath) {
  if (!existsSync(localPath)) throw new Error(`Arquivo não existe: ${localPath}`);
  await readFile(localPath);
  throw new Error('uploadImage não implementado. Configure storage público (S3, R2, GitHub Pages) e passe URL.');
}
