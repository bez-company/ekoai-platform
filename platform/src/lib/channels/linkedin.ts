// Publicação LinkedIn — porta de src/channels/linkedin.js. Diferença: a arte é
// URL pública (Supabase Storage), então baixamos o binário e subimos via
// initializeUpload (a API exige PUT binário, não aceita URL remota).
// Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api

const API_BASE = 'https://api.linkedin.com/rest';
// LinkedIn desativa cada versão ~1 ano depois; versão vencida devolve erro em toda chamada.
const VERSION = process.env.LINKEDIN_VERSION || '202610';

function token(): string {
  const t = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!t) throw new Error('LINKEDIN_ACCESS_TOKEN ausente');
  return t;
}

function authorUrn(): string {
  const urn = process.env.LINKEDIN_AUTHOR_URN;
  if (!urn) throw new Error('LINKEDIN_AUTHOR_URN ausente (formato: urn:li:person:XXX)');
  return urn;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    'LinkedIn-Version': VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

async function apiJson(method: string, endpoint: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${text}`);
  }
  if (res.status === 201 || res.status === 204) {
    return { id: res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') };
  }
  const text = await res.text(); // finalizeUpload responde 200 sem corpo
  return text ? JSON.parse(text) : {};
}

async function uploadImageFromUrl(imageUrl: string): Promise<string> {
  const init = await apiJson('POST', '/images?action=initializeUpload', {
    initializeUploadRequest: { owner: authorUrn() },
  });
  const uploadUrl = init.value?.uploadUrl;
  const imageUrn = init.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error('Resposta inesperada de initializeUpload');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Falha ao baixar arte ${imageUrl}: ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const upRes = await fetch(uploadUrl, { method: 'PUT', body: buffer });
  if (!upRes.ok) throw new Error(`Falha upload imagem LinkedIn: ${upRes.status} ${await upRes.text()}`);
  return imageUrn;
}

// Comentário como o perfil: no próprio post (link no 1º comentário: LinkedIn derruba alcance
// de post com link no corpo) ou no post de outra pessoa (SPEC 005). Com `parentComment`, é
// resposta a um comentário: o alvo do path vira o comentário. URNs vão codificadas no path.
// Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/comments-api
export async function commentOnPost(
  postUrn: string,
  text: string,
  { parentComment }: { parentComment?: string | null } = {},
): Promise<{ id: string | null }> {
  const target = parentComment || postUrn;
  const body: Record<string, unknown> = { actor: authorUrn(), object: postUrn, message: { text } };
  if (parentComment) body.parentComment = parentComment;
  const r = await apiJson('POST', `/socialActions/${encodeURIComponent(target)}/comments`, body);
  return { id: r?.id ?? null };
}

// Título que aparece em cima do documento no feed: o gancho do post, curto.
export function documentTitle(hook?: string | null): string {
  const clean = String(hook || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Documento';
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Documento e vídeo são processados de forma assíncrona depois do upload. Espera ficar
// AVAILABLE (até ~20s, cabe no maxDuration do cron); se não ficar, tenta postar mesmo assim.
async function waitAvailable(
  resource: 'documents' | 'videos',
  urn: string,
  tries = 10,
  intervalMs = 2000,
): Promise<string> {
  const label = resource === 'documents' ? 'o PDF' : 'o vídeo';
  let status = 'UNKNOWN';
  for (let i = 0; i < tries; i += 1) {
    const asset = await apiJson('GET', `/${resource}/${encodeURIComponent(urn)}`);
    status = asset?.status ?? 'UNKNOWN';
    if (status === 'AVAILABLE') return status;
    if (status === 'PROCESSING_FAILED') {
      throw new Error(`LinkedIn não conseguiu processar ${label} (${asset?.processingFailureReason || 'PROCESSING_FAILED'})`);
    }
    await sleep(intervalMs);
  }
  return status;
}

async function uploadDocumentFromUrl(documentUrl: string): Promise<string> {
  const init = await apiJson('POST', '/documents?action=initializeUpload', {
    initializeUploadRequest: { owner: authorUrn() },
  });
  const uploadUrl = init.value?.uploadUrl;
  const documentUrn = init.value?.document;
  if (!uploadUrl || !documentUrn) throw new Error('Resposta inesperada de documents initializeUpload');

  const pdfRes = await fetch(documentUrl);
  if (!pdfRes.ok) throw new Error(`Falha ao baixar PDF ${documentUrl}: ${pdfRes.status}`);
  const buffer = Buffer.from(await pdfRes.arrayBuffer());

  const upRes = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token()}` }, body: buffer });
  if (!upRes.ok) throw new Error(`Falha upload PDF LinkedIn: ${upRes.status} ${await upRes.text()}`);
  return documentUrn;
}

// Carrossel do LinkedIn = post de documento (PDF, uma página por slide).
// Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/documents-api
export async function publishDocument(
  text: string,
  documentUrl: string,
  title?: string | null,
): Promise<{ id: string; channel: 'linkedin'; document: string; documentStatus: string }> {
  const documentUrn = await uploadDocumentFromUrl(documentUrl);
  const documentStatus = await waitAvailable('documents', documentUrn);
  const r = await apiJson('POST', '/posts', {
    author: authorUrn(),
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { title: documentTitle(title), id: documentUrn } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
  return { id: r.id, channel: 'linkedin', document: documentUrn, documentStatus };
}

export async function publishText(text: string, imageUrl?: string | null): Promise<{ id: string; channel: 'linkedin' }> {
  let mediaUrn: string | null = null;
  if (imageUrl) mediaUrn = await uploadImageFromUrl(imageUrl);

  const body: Record<string, unknown> = {
    author: authorUrn(),
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (mediaUrn) body.content = { media: { id: mediaUrn } };

  const r = await apiJson('POST', '/posts', body);
  return { id: r.id, channel: 'linkedin' };
}

// Vídeo (SPEC 005 R2): initializeUpload devolve as partes (4 MB cada); cada PUT devolve um
// ETag, que o finalizeUpload recebe na mesma ordem. MP4, de 3 s a 30 min.
// Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api
export async function uploadVideoFromUrl(videoUrl: string): Promise<string> {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Falha ao baixar vídeo ${videoUrl}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const init = await apiJson('POST', '/videos?action=initializeUpload', {
    initializeUploadRequest: { owner: authorUrn(), fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false },
  });
  const videoUrn = init.value?.video;
  const parts: { uploadUrl: string; firstByte: number; lastByte: number }[] = init.value?.uploadInstructions || [];
  if (!videoUrn || !parts.length) throw new Error('Resposta inesperada de videos initializeUpload');

  const etags: string[] = [];
  for (const part of parts) {
    const up = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes.slice(part.firstByte, part.lastByte + 1),
    });
    if (!up.ok) throw new Error(`Falha upload vídeo LinkedIn (bytes ${part.firstByte}-${part.lastByte}): ${up.status}`);
    const etag = up.headers.get('etag');
    if (!etag) throw new Error('LinkedIn não devolveu o ETag da parte do vídeo');
    etags.push(etag);
  }

  await apiJson('POST', '/videos?action=finalizeUpload', {
    finalizeUploadRequest: { video: videoUrn, uploadToken: init.value?.uploadToken ?? '', uploadedPartIds: etags },
  });
  return videoUrn;
}

export async function publishVideo(
  text: string,
  videoUrl: string,
  title?: string | null,
): Promise<{ id: string; channel: 'linkedin'; video: string; videoStatus: string }> {
  const videoUrn = await uploadVideoFromUrl(videoUrl);
  const videoStatus = await waitAvailable('videos', videoUrn);
  const r = await apiJson('POST', '/posts', {
    author: authorUrn(),
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { title: documentTitle(title), id: videoUrn } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
  return { id: r.id, channel: 'linkedin', video: videoUrn, videoStatus };
}
