// Publicação Instagram, reduzida ao que o publish AGENDADO precisa: a arte já é URL pública (bucket
// da plataforma), então não há upload nem render aqui, só criar o container e chamar media_publish.
// O token e o id da conta vêm da conexão da conta (social-accounts.ts), nunca do ambiente.
// Docs: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login

import { GRAPH_URL } from '../instagram-oauth-model';

const API_BASE = GRAPH_URL;

export type InstagramCredentials = { accountId: string; token: string };

// Sem teto, uma conexão pendurada seguraria o ciclo do cron até o limite da rota e o post ficaria
// em `publishing` sem resposta. Estourar o tempo no media_publish é resultado INCERTO (ver abaixo).
const REQUEST_TIMEOUT_MS = 25_000;

// Resposta de erro da Graph API, com o status HTTP à parte: 4xx é recusa (nada foi publicado), 5xx não diz.
export class IgApiError extends Error {
  constructor(readonly status: number, body: string) {
    super(`IG API ${status}: ${body}`);
  }
}

// O media_publish não deu resposta confiável (timeout, conexão caiu, 5xx): o post pode ter ido ao ar.
// Quem recebe isto NÃO tenta de novo: consulta o container na Meta (containerStatus) e só então decide.
export class UncertainPublishError extends Error {
  constructor(readonly containerId: string, reason: string) {
    super(`Resultado incerto do media_publish (container ${containerId}): ${reason}`);
  }
}

// Ganchos da publicação. `onContainer` roda e é aguardado ANTES do media_publish: se não der para
// gravar o id do container, a publicação para sem ter ido ao ar.
export type PublishHooks = { onContainer?: (containerId: string) => Promise<void> };

async function apiPost(creds: InstagramCredentials, endpoint: string, params: Record<string, string>): Promise<{ id: string }> {
  const url = new URL(`${API_BASE}${endpoint}`);
  const form = new URLSearchParams({ ...params, access_token: creds.token });
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new IgApiError(res.status, text);
  }
  return res.json();
}

// media_publish de um container pronto. Recusa da Meta (4xx) sobe como veio: nada foi publicado.
// Timeout, rede e 5xx sobem como incertos. Publicar o mesmo container duas vezes não duplica (a Meta
// recusa a segunda), por isso esta é a única chamada que pode ser refeita depois de consultar o container.
export async function publishContainer(creds: InstagramCredentials, containerId: string): Promise<{ id: string }> {
  try {
    return await apiPost(creds, `/${creds.accountId}/media_publish`, { creation_id: containerId });
  } catch (e) {
    if (e instanceof IgApiError && e.status < 500) throw e;
    throw new UncertainPublishError(containerId, e instanceof Error ? e.message : String(e));
  }
}

export type ContainerState = 'PUBLISHED' | 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED';

// O que a Meta diz do container: PUBLISHED = já virou post (o media_publish deu certo, mesmo que a
// resposta tenha se perdido); FINISHED = pronto e ainda não publicado.
export async function containerStatus(creds: InstagramCredentials, containerId: string): Promise<ContainerState> {
  const url = new URL(`${API_BASE}/${containerId}`);
  url.searchParams.set('fields', 'status_code');
  url.searchParams.set('access_token', creds.token);
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new IgApiError(res.status, await res.text());
  const { status_code } = (await res.json()) as { status_code: ContainerState };
  return status_code;
}

// Acha o post que o container virou: o mais recente com a mesma legenda, publicado depois de `since`.
// A Meta não devolve o id do post a partir do container; sem achar, devolve null (o post está no ar, só
// não dá para ligar as métricas).
export async function findPublishedMedia(creds: InstagramCredentials, caption: string, since: string): Promise<string | null> {
  const url = new URL(`${API_BASE}/${creds.accountId}/media`);
  url.searchParams.set('fields', 'id,caption,timestamp');
  url.searchParams.set('limit', '10');
  url.searchParams.set('access_token', creds.token);
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new IgApiError(res.status, await res.text());
  const { data } = (await res.json()) as { data?: Array<{ id: string; caption?: string; timestamp?: string }> };
  const sinceMs = Date.parse(since);
  const match = (data || []).find((m) => {
    // A Meta escreve o fuso como +0000; normaliza para o formato que o Date lê em qualquer motor.
    const at = Date.parse((m.timestamp || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return (m.caption || '') === (caption || '') && Number.isFinite(at) && at >= sinceMs;
  });
  return match?.id ?? null;
}

async function waitContainerReady(creds: InstagramCredentials, containerId: string, timeoutMs = 60000, intervalMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status_code = await containerStatus(creds, containerId);
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

export async function publishSingle(creds: InstagramCredentials, imageUrl: string, caption: string, altText: string | null = null, hooks: PublishHooks = {}): Promise<{ id: string; channel: 'instagram'; alt_text: AltTextOutcome }> {
  if (!imageUrl) throw new Error('imageUrl obrigatório (URL pública)');
  const container = await createImageContainer(creds, { image_url: imageUrl, caption: caption || '' }, altText);
  await hooks.onContainer?.(container.id);
  await waitContainerReady(creds, container.id);
  const published = await publishContainer(creds, container.id);
  return { id: published.id, channel: 'instagram', alt_text: container.altText };
}

export async function publishCarousel(creds: InstagramCredentials, imageUrls: string[], caption: string, hooks: PublishHooks = {}): Promise<{ id: string; channel: 'instagram'; slides: number }> {
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
  await hooks.onContainer?.(container.id);
  await waitContainerReady(creds, container.id);
  const published = await publishContainer(creds, container.id);
  return { id: published.id, channel: 'instagram', slides: imageUrls.length };
}
