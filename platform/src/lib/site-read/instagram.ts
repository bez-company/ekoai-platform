// instagram.ts: as legendas recentes do Instagram da conta, para a leitura da marca entender melhor o jeito de falar (SPEC 033, BEZ-528).
// Só com o Instagram que a própria conta conectou: usa o token dela (nunca o de outra) e a API da Meta; perfil público de terceiros não é
// lido. Pede só legenda, link, data e tipo, não guarda nada e não põe o token no log. Sem conexão, conexão vencida ou falha da Meta, a
// leitura segue só com o site e a tela diz por quê. Server-only.

import { GRAPH_URL } from '../instagram-oauth-model';
import { UserError } from '../errors';
import { log } from '../log';
import { instagramCredentials } from '../social-accounts';
import type { InstagramCredentials } from '../channels/instagram';
import type { TenantDb } from '../tenant-db';
import type { SitePage } from './understand-model';

export type InstagramState = 'ok' | 'not_connected' | 'expired' | 'failed';
export type InstagramPosts = { state: InstagramState; pages: SitePage[] };

const FETCH_LIMIT = 30;
const MAX_CAPTIONS = 20;
const CAPTION_MAX = 800;
const CAPTION_MIN = 20;
const TIMEOUT_MS = 10_000;

// A resposta da Meta como páginas de texto: cada legenda com o link do post como origem. Legenda curta demais não diz nada do jeito de
// falar, e link que não é https não serve de origem.
export function parseCaptions(json: unknown): SitePage[] {
  const data = json && typeof json === 'object' ? (json as { data?: unknown }).data : null;
  const pages: SitePage[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const caption = typeof item.caption === 'string' ? item.caption.replace(/\s+/g, ' ').trim() : '';
    const link = typeof item.permalink === 'string' ? item.permalink : '';
    if (caption.length < CAPTION_MIN || !/^https:\/\/(www\.)?instagram\.com\//i.test(link)) continue;
    pages.push({ url: link, text: caption.slice(0, CAPTION_MAX), source: 'instagram' });
    if (pages.length === MAX_CAPTIONS) break;
  }
  return pages;
}

type Deps = { fetchFn?: typeof fetch; credentials?: (t: TenantDb) => Promise<InstagramCredentials> };

export async function readInstagramPosts(t: TenantDb, deps: Deps = {}): Promise<InstagramPosts> {
  let creds: InstagramCredentials;
  try {
    creds = await (deps.credentials ?? instagramCredentials)(t);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return { state: /venceu/i.test(e.message) ? 'expired' : 'not_connected', pages: [] };
  }
  try {
    const url = new URL(`${GRAPH_URL}/${creds.accountId}/media`);
    url.searchParams.set('fields', 'caption,permalink,timestamp,media_type');
    url.searchParams.set('limit', String(FETCH_LIMIT));
    url.searchParams.set('access_token', creds.token);
    const res = await (deps.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Graph API ${res.status}`);
    return { state: 'ok', pages: parseCaptions(await res.json().catch(() => null)) };
  } catch (e) {
    // Só o motivo no log: a mensagem da rede pode trazer a URL com o token.
    log('warn', 'site-read', 'não leu o Instagram', { reason: e instanceof Error && /^Graph API \d+$/.test(e.message) ? e.message : 'network' });
    return { state: 'failed', pages: [] };
  }
}
