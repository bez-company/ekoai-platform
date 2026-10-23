// Publicação Instagram, reduzida ao que o publish AGENDADO precisa: a arte já é URL pública (bucket
// da plataforma), então não há upload nem render aqui, só criar o container e chamar media_publish.
// O token e o id da conta vêm da conexão da conta (social-accounts.ts), nunca do ambiente.
// Docs: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login

import { GRAPH_URL } from '../instagram-oauth-model';

const API_BASE = GRAPH_URL;

export type InstagramCredentials = { accountId: string; token: string };

async function apiPost(creds: InstagramCredentials, endpoint: string, params: Record<string, string>): Promise<{ id: string }> {
  const url = new URL(`${API_BASE}${endpoint}`);
  const form = new URLSearchParams({ ...params, access_token: creds.token });
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IG API ${res.status}: ${text}`);
  }
  return res.json();
}

async function waitContainerReady(creds: InstagramCredentials, containerId: string, timeoutMs = 60000, intervalMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = new URL(`${API_BASE}/${containerId}`);
    url.searchParams.set('fields', 'status_code');
    url.searchParams.set('access_token', creds.token);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`IG status check ${res.status}: ${await res.text()}`);
    const { status_code } = (await res.json()) as { status_code: string };
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} status=${status_code}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} não ficou pronto em ${timeoutMs}ms`);
}

export type AltTextOutcome = 'sent' | 'dropped' | 'none';

// Texto alternativo (BEZ-203): a Meta aceita `alt_text` no container de imagem desde 24/03/2025 (até
// 1000 caracteres, imagem única ou imagem de carrossel). A referência não diz se vale em toda versão
// nem no login do Instagram; se o container for recusado com o campo, cria de novo sem ele: o post
// sai, o texto alternativo não, e o resultado diz isso. Outro erro falha de novo na segunda tentativa.
async function createImageContainer(creds: InstagramCredentials, params: Record<string, string>, altText: string | null): Promise<{ id: string; altText: AltTextOutcome }> {
  if (!altText) return { ...(await apiPost(creds, `/${creds.accountId}/media`, params)), altText: 'none' };
  try {
    return { ...(await apiPost(creds, `/${creds.accountId}/media`, { ...params, alt_text: altText })), altText: 'sent' };
  } catch (e) {
    if (!/IG API 400/.test(e instanceof Error ? e.message : '')) throw e;
    return { ...(await apiPost(creds, `/${creds.accountId}/media`, params)), altText: 'dropped' };
  }
}

export async function publishSingle(creds: InstagramCredentials, imageUrl: string, caption: string, altText: string | null = null): Promise<{ id: string; channel: 'instagram'; alt_text: AltTextOutcome }> {
  if (!imageUrl) throw new Error('imageUrl obrigatório (URL pública)');
  const container = await createImageContainer(creds, { image_url: imageUrl, caption: caption || '' }, altText);
  await waitContainerReady(creds, container.id);
  const published = await apiPost(creds, `/${creds.accountId}/media_publish`, { creation_id: container.id });
  return { id: published.id, channel: 'instagram', alt_text: container.altText };
}

export async function publishCarousel(creds: InstagramCredentials, imageUrls: string[], caption: string): Promise<{ id: string; channel: 'instagram'; slides: number }> {
  if (!imageUrls || imageUrls.length < 2) throw new Error('Carousel precisa 2+ imagens');
  if (imageUrls.length > 10) throw new Error('Carousel suporta no máximo 10 slides');

  const childIds: string[] = [];
  for (const url of imageUrls) {
    const child = await apiPost(creds, `/${creds.accountId}/media`, { image_url: url, is_carousel_item: 'true' });
    childIds.push(child.id);
  }
  for (const id of childIds) await waitContainerReady(creds, id);

  const container = await apiPost(creds, `/${creds.accountId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption || '',
  });
  await waitContainerReady(creds, container.id);
  const published = await apiPost(creds, `/${creds.accountId}/media_publish`, { creation_id: container.id });
  return { id: published.id, channel: 'instagram', slides: imageUrls.length };
}
