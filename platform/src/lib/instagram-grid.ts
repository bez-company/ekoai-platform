// instagram-grid.ts: lê os últimos posts do perfil para a prévia na grade (SPEC 023, BEZ-200). Usa o token da
// conexão da conta (nunca o de outra), pede só os campos de GRID_FIELDS e não guarda a imagem: a URL da CDN
// da Meta expira, então a leitura fica 10 minutos em memória por conta e o navegador carrega a imagem direto.
// Sem a Meta (não conectado, vencido ou falha), cai nos posts que a Ekoai publicou. O token nunca vai ao log. Server-only.

import { GRAPH_URL } from './instagram-oauth-model';
import { UserError } from './errors';
import { log } from './log';
import { listPublished } from './published-feed';
import { instagramCredentials } from './social-accounts';
import type { InstagramCredentials } from './channels/instagram';
import type { TenantDb } from './tenant-db';
import { GRID_FIELDS, GRID_LIMIT, parseGridMedia, type GridItem, type GridView } from './instagram-grid-model';

const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;
// A Meta pode devolver itens sem imagem utilizável; pedir um pouco a mais mantém os 8 quando sobram.
const FETCH_LIMIT = 12;

type Deps = { fetchFn?: typeof fetch; nowMs?: number; credentials?: (t: TenantDb) => Promise<InstagramCredentials> };

const cache = new Map<string, { at: number; items: GridItem[] }>();
export const clearGridCache = () => cache.clear();

async function readMeta(fetchFn: typeof fetch, creds: InstagramCredentials): Promise<GridItem[]> {
  const url = new URL(`${GRAPH_URL}/${creds.accountId}/media`);
  url.searchParams.set('fields', GRID_FIELDS);
  url.searchParams.set('limit', String(FETCH_LIMIT));
  url.searchParams.set('access_token', creds.token);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Graph API ${res.status}`);
  return parseGridMedia(await res.json().catch(() => null), GRID_LIMIT);
}

// Os posts que a Ekoai publicou, com imagem. É o que dá para mostrar sem a Meta.
async function ekoaiPosts(t: TenantDb): Promise<GridItem[]> {
  const published = await listPublished(t, GRID_LIMIT * 2);
  return published
    .filter((p) => p.channel === 'instagram' && p.imageUrl)
    .slice(0, GRID_LIMIT)
    .map((p) => ({ id: p.id, type: p.slides > 0 ? ('CAROUSEL_ALBUM' as const) : ('IMAGE' as const), imageUrl: p.imageUrl!, permalink: null, timestamp: p.publishedAt }));
}

async function fallback(t: TenantDb, reason: NonNullable<GridView['reason']>): Promise<GridView> {
  const items = await ekoaiPosts(t).catch((e) => {
    log('warn', 'instagram-grid', 'não leu os posts da Ekoai', { error: e instanceof Error ? e.message : String(e) });
    return [] as GridItem[];
  });
  return { source: items.length ? 'ekoai' : 'none', items, reason };
}

export async function readGrid(t: TenantDb, deps: Deps = {}): Promise<GridView> {
  const nowMs = deps.nowMs ?? Date.now();
  let creds: InstagramCredentials;
  try {
    creds = await (deps.credentials ?? instagramCredentials)(t);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return fallback(t, /venceu/i.test(e.message) ? 'expired' : 'not_connected');
  }

  const key = `${t.tenantId}:${creds.accountId}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < TTL_MS) return { source: 'meta', items: hit.items, reason: null };

  try {
    const items = await readMeta(deps.fetchFn ?? fetch, creds);
    cache.set(key, { at: nowMs, items });
    return { source: 'meta', items, reason: null };
  } catch (e) {
    // Só o motivo no log: a mensagem da rede pode trazer a URL com o token.
    log('warn', 'instagram-grid', 'não leu o Instagram', { reason: e instanceof Error && /^Graph API \d+$/.test(e.message) ? e.message : 'network' });
    return fallback(t, 'meta_failed');
  }
}
