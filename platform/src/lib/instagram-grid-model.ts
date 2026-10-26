// instagram-grid-model.ts: a prévia do post na grade do perfil (SPEC 023, BEZ-200). Puro. Valida o
// retorno da Graph API na entrada (nunca confia no formato nem no host da imagem) e faz a conta do
// corte que o Instagram aplica na miniatura do perfil.

export const GRID_LIMIT = 8;
// Campos pedidos ao /{conta}/media. O escopo instagram_business_basic, que a conexão já exige, cobre todos.
export const GRID_FIELDS = 'id,media_type,media_url,thumbnail_url,permalink,timestamp';

export type GridMediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
export type GridItem = { id: string; type: GridMediaType; imageUrl: string; permalink: string | null; timestamp: string | null };

// De onde veio a grade: `meta` lê o Instagram (inclui o que foi publicado à mão); `ekoai` só tem os posts que a
// Ekoai publicou (a leitura da Meta falhou ou o Instagram não está conectado); `none` não tem nenhum.
export type GridSource = 'meta' | 'ekoai' | 'none';
export type GridReason = 'not_connected' | 'expired' | 'meta_failed';
export type GridView = { source: GridSource; items: GridItem[]; reason: GridReason | null };

const TYPES: readonly GridMediaType[] = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'];

// As imagens da Meta vêm da CDN do Instagram. Qualquer outro endereço no retorno é descartado: o navegador
// da pessoa só carrega imagem de um destino que conhecemos.
export function isMetaImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === 'cdninstagram.com' || host.endsWith('.cdninstagram.com') || host === 'fbcdn.net' || host.endsWith('.fbcdn.net');
}

const asString = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

function permalinkOf(v: unknown): string | null {
  const s = asString(v, 512);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && (u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com') ? s : null;
  } catch {
    return null;
  }
}

function timestampOf(v: unknown): string | null {
  const s = asString(v, 40);
  if (!s) return null;
  // A Meta escreve o fuso como +0000; normaliza para o formato que o Date lê em qualquer motor.
  const ms = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Vídeo e Reel mostram a capa (thumbnail_url); imagem e carrossel, a primeira imagem (media_url). Item sem
// imagem utilizável é pulado; o resto da lista segue. Nunca lança: resposta fora do contrato vira lista vazia.
export function parseGridMedia(json: unknown, limit = GRID_LIMIT): GridItem[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const items: GridItem[] = [];
  for (const raw of data) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = asString(r.id, 64);
    const type = TYPES.find((t) => t === r.media_type);
    if (!id || !type) continue;
    const imageUrl = type === 'VIDEO' ? r.thumbnail_url : r.media_url;
    if (!isMetaImageUrl(imageUrl)) continue;
    items.push({ id, type, imageUrl, permalink: permalinkOf(r.permalink), timestamp: timestampOf(r.timestamp) });
  }
  // Mais recente primeiro; sem data, a ordem da Meta (que já vem do mais novo para o mais antigo) é mantida.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.timestamp ?? '').localeCompare(a.item.timestamp ?? '') || a.i - b.i)
    .map((x) => x.item)
    .slice(0, limit);
}

// ── Corte da miniatura ───────────────────────────────────────────────────────────────────────────
// O perfil mostra cada post recortado ao centro numa miniatura vertical 3:4 (confirmado no perfil do Matheus
// em 26/10/2026). A razão fica aqui, num lugar só, caso o Instagram mude de novo.
export const GRID_THUMB_RATIO = 3 / 4;

const RATIO: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '1.91:1': 1.91 };

// Quanto de cada lado o corte tira do post, em porcentagem do lado cortado: `x` corta esquerda e direita,
// `y` corta em cima e embaixo. Post mais largo que a miniatura perde dos lados; mais estreito, em cima e embaixo.
export function cropBands(postRatio: string): { axis: 'x' | 'y' | null; percent: number } {
  const post = RATIO[postRatio];
  if (!post || Math.abs(post - GRID_THUMB_RATIO) < 1e-9) return { axis: null, percent: 0 };
  if (post > GRID_THUMB_RATIO) return { axis: 'x', percent: round(((1 - GRID_THUMB_RATIO / post) / 2) * 100) };
  return { axis: 'y', percent: round(((1 - post / GRID_THUMB_RATIO) / 2) * 100) };
}

const round = (n: number) => Math.round(n * 100) / 100;

// Texto de cima da grade: de onde vieram os posts e, se for o caso, o que fazer.
export function gridNotice(view: GridView): { tone: 'info' | 'warning'; text: string; action: 'connect' | 'retry' | null } | null {
  if (view.source === 'meta') return null;
  if (view.reason === 'not_connected') return { tone: 'info', text: 'O Instagram não está conectado. Só o post novo aparece. Conecte para ver os seus últimos posts ao lado dele.', action: 'connect' };
  if (view.reason === 'expired') return { tone: 'warning', text: 'A conexão do Instagram venceu. Reconecte para ver os seus últimos posts.', action: 'connect' };
  return { tone: 'warning', text: 'Não consegui ler o Instagram agora. Mostrando só os posts feitos pela Ekoai. Os publicados à mão não aparecem.', action: 'retry' };
}
