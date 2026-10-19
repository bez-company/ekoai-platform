// linkedin.js — publica post (texto + imagem ou PDF carrossel) via LinkedIn API v2.
// Chamado por: src/metrics.js e src/refresh-tokens.js (a publicação mora na plataforma). Docs: learn.microsoft.com/linkedin/marketing/integrations/community-management/shares/posts-api
//
// Fluxo /rest/posts (versionado, header LinkedIn-Version):
//   1. POST /rest/images?action=initializeUpload (registra slot)
//   2. PUT upload binário no URL retornado
//   3. POST /rest/posts com content.media referenciando image URN

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { withRetry } from '../utils/retry.js';

const API_BASE = 'https://api.linkedin.com/rest';
// LinkedIn desativa cada versão ~1 ano depois; versão vencida devolve erro em toda chamada.
const VERSION = process.env.LINKEDIN_VERSION || '202610';

function token() {
  const t = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!t) throw new Error('LINKEDIN_ACCESS_TOKEN ausente');
  return t;
}

function authorUrn() {
  const urn = process.env.LINKEDIN_AUTHOR_URN;
  if (!urn) throw new Error('LINKEDIN_AUTHOR_URN ausente (formato: urn:li:person:XXX)');
  return urn;
}

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${token()}`,
    'LinkedIn-Version': VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

// retry:false no POST /posts (publicação) — evita post duplicado se a resposta
// se perder após sucesso. Init/upload de imagem são seguros pra re-tentar.
async function apiJson(method, endpoint, body, { retry = true } = {}) {
  const run = async () => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`LinkedIn API ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 201 || res.status === 204) {
      return { id: res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') };
    }
    return res.json();
  };
  return retry ? withRetry(run, { label: `LinkedIn ${endpoint}` }) : run();
}

async function uploadImage(localPath) {
  if (!existsSync(localPath)) throw new Error(`Arquivo não existe: ${localPath}`);

  const init = await apiJson('POST', '/images?action=initializeUpload', {
    initializeUploadRequest: { owner: authorUrn() },
  });

  const uploadUrl = init.value?.uploadUrl;
  const imageUrn = init.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error('Resposta inesperada de initializeUpload');

  const buffer = await readFile(localPath);
  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
  });
  if (!upRes.ok) {
    throw new Error(`Falha upload imagem LinkedIn: ${upRes.status} ${await upRes.text()}`);
  }

  return imageUrn;
}

export async function publishText({ text, imagePath, dryRun = false }) {
  if (dryRun) {
    return { id: 'mock_li_post_id', dryRun: true, channel: 'linkedin', textLength: text?.length || 0, hasImage: !!imagePath };
  }

  let mediaUrn = null;
  if (imagePath) {
    mediaUrn = await uploadImage(imagePath);
  }

  const body = {
    author: authorUrn(),
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  if (mediaUrn) {
    body.content = { media: { id: mediaUrn } };
  }

  return apiJson('POST', '/posts', body, { retry: false });
}

// Título que aparece em cima do documento no feed: o gancho do post, curto.
export function documentTitle(hook) {
  const clean = String(hook || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Documento';
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// O LinkedIn processa o PDF depois do upload; espera AVAILABLE (até ~20s) antes de postar.
async function waitDocumentAvailable(documentUrn, tries = 10, intervalMs = 2000) {
  let status = 'UNKNOWN';
  for (let i = 0; i < tries; i += 1) {
    const doc = await apiJson('GET', `/documents/${encodeURIComponent(documentUrn)}`);
    status = doc?.status ?? 'UNKNOWN';
    if (status === 'AVAILABLE') return status;
    if (status === 'PROCESSING_FAILED') throw new Error('LinkedIn não conseguiu processar o PDF (PROCESSING_FAILED)');
    await sleep(intervalMs);
  }
  return status;
}

// Carrossel do LinkedIn = post de documento (PDF já renderizado e público, uma página por slide).
// Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/documents-api
export async function publishDocument({ text, documentUrl, title, dryRun = false }) {
  if (dryRun) {
    return { id: 'mock_li_document_id', dryRun: true, channel: 'linkedin', documentUrl };
  }
  const init = await apiJson('POST', '/documents?action=initializeUpload', {
    initializeUploadRequest: { owner: authorUrn() },
  });
  const uploadUrl = init.value?.uploadUrl;
  const documentUrn = init.value?.document;
  if (!uploadUrl || !documentUrn) throw new Error('Resposta inesperada de documents initializeUpload');

  const pdfRes = await fetch(documentUrl);
  if (!pdfRes.ok) throw new Error(`Falha ao baixar PDF ${documentUrl}: ${pdfRes.status}`);
  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token()}` },
    body: Buffer.from(await pdfRes.arrayBuffer()),
  });
  if (!upRes.ok) throw new Error(`Falha upload PDF LinkedIn: ${upRes.status} ${await upRes.text()}`);

  const documentStatus = await waitDocumentAvailable(documentUrn);
  const r = await apiJson('POST', '/posts', {
    author: authorUrn(),
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { title: documentTitle(title), id: documentUrn } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }, { retry: false });
  return { id: r.id, channel: 'linkedin', document: documentUrn, documentStatus, documentUrl };
}

// Coleta likes/comentários de um post via socialActions. Impressões exigem
// o endpoint de organizationalEntityShareStatistics (só páginas de empresa) —
// deixado como null quando indisponível. Best-effort, não quebra a coleta.
export async function getInsights(shareUrn) {
  if (!shareUrn) return null;
  const out = { likes: null, comments: null, impressions: null };

  try {
    const encoded = encodeURIComponent(shareUrn);
    const res = await fetch(`${API_BASE}/socialActions/${encoded}`, { headers: headers() });
    if (res.ok) {
      const json = await res.json();
      out.likes = json.likesSummary?.totalLikes ?? null;
      out.comments = json.commentsSummary?.totalComments ?? json.commentsSummary?.aggregatedTotalComments ?? null;
    }
  } catch (_) { /* mantém null */ }

  return out;
}

export async function refreshToken() {
  const refresh = process.env.LINKEDIN_REFRESH_TOKEN;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) {
    throw new Error('LINKEDIN_REFRESH_TOKEN, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET necessários');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`LinkedIn refresh ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function checkTokenHealth() {
  const res = await fetch(`${API_BASE}/me`, { headers: headers() });
  if (!res.ok) {
    return { valid: false, error: `${res.status} ${await res.text()}` };
  }
  // LinkedIn não expõe expires_at via API; precisa rastrear localmente.
  // Por ora: se /me responde 200, token válido.
  return { valid: true, daysLeft: null, note: 'LinkedIn não expõe expiry via API; rastreie data de geração' };
}
