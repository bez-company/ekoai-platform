// instagram-oauth.ts: as chamadas à Meta da conexão do Instagram (SPEC 011 R5): configuração do app,
// troca do código por token de longa duração e leitura do perfil. O token e o segredo do app nunca
// vão para o log nem para o navegador. Server-only.

import {
  EXCHANGE_URL,
  GRAPH_URL,
  TOKEN_URL,
  ConnectError,
  expiresAtFrom,
  isPermanentMetaFailure,
  isProfessional,
  missingScopes,
  parseJsonKeepingIds,
  parseLongToken,
  parseProfile,
  parseShortToken,
  type InstagramProfile,
} from './instagram-oauth-model';
import { log } from './log';

type FetchFn = typeof fetch;

export type InstagramApp = { appId: string; appSecret: string };

// O servidor lê as duas em runtime (Secret Manager). Sem elas a conexão fica indisponível e a tela diz isso.
export function instagramApp(env: Record<string, string | undefined> = process.env): InstagramApp | null {
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

export type ConnectedInstagram = {
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
  profile: InstagramProfile;
};

// A Meta recusou ou não respondeu. Só status, código e tipo: nunca a URL (leva segredo) nem o corpo.
export class MetaApiError extends Error {
  constructor(
    public readonly step: string,
    public readonly status: number | null,
    public readonly code: number | null = null,
    public readonly type: string | null = null,
  ) {
    super(`Meta ${step}: ${status ?? 'sem resposta'}`);
  }

  get permanent(): boolean {
    return isPermanentMetaFailure({ status: this.status, code: this.code, type: this.type });
  }
}

async function readJson(res: Response, step: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let reason = '';
    let code: number | null = null;
    let type: string | null = null;
    try {
      const body = JSON.parse(text) as { code?: unknown; error_type?: unknown; error_message?: string; error?: { message?: string; code?: unknown; type?: unknown } };
      reason = String(body.error_message ?? body.error?.message ?? '').slice(0, 200);
      const rawCode = body.error?.code ?? body.code;
      code = typeof rawCode === 'number' ? rawCode : null;
      const rawType = body.error?.type ?? body.error_type;
      type = typeof rawType === 'string' ? rawType.slice(0, 60) : null;
    } catch {
      /* corpo que não é JSON: fica só o status */
    }
    log('warn', 'instagram/oauth', 'a Meta recusou o passo', { step, status: res.status, code, type, reason });
    throw new MetaApiError(step, res.status, code, type);
  }
  return parseJsonKeepingIds(text);
}

// Falha de rede conta como erro transitório (sem status), para a renovação tentar de novo.
async function call(step: string, fetchFn: FetchFn, input: Parameters<FetchFn>[0], init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(input, init);
  } catch {
    log('warn', 'instagram/oauth', 'sem resposta da Meta', { step });
    throw new MetaApiError(step, null);
  }
  return readJson(res, step);
}

// Troca o `code` do callback por um token de 60 dias e confere conta profissional e permissões.
export async function connectWithCode(
  input: { code: string; redirectUri: string; app: InstagramApp },
  fetchFn: FetchFn = fetch,
  nowMs: number = Date.now(),
): Promise<ConnectedInstagram> {
  const form = new URLSearchParams({
    client_id: input.app.appId,
    client_secret: input.app.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const short = parseShortToken(
    await call('code', fetchFn, TOKEN_URL, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
  );
  if (missingScopes(short.permissions).length > 0) throw new ConnectError('no_publish');

  const exchange = new URL(EXCHANGE_URL);
  exchange.searchParams.set('grant_type', 'ig_exchange_token');
  exchange.searchParams.set('client_secret', input.app.appSecret);
  exchange.searchParams.set('access_token', short.accessToken);
  const long = parseLongToken(await call('exchange', fetchFn, exchange));

  const me = new URL(`${GRAPH_URL}/me`);
  me.searchParams.set('fields', 'user_id,username,account_type');
  me.searchParams.set('access_token', long.accessToken);
  const profile = parseProfile(await call('profile', fetchFn, me));
  if (!isProfessional(profile)) throw new ConnectError('not_professional');

  return {
    accessToken: long.accessToken,
    expiresAt: expiresAtFrom(nowMs, long.expiresInSeconds),
    scopes: short.permissions,
    profile,
  };
}

// Renova um token de longa duração por mais 60 dias. O token precisa ter pelo menos 24 horas, estar
// válido e manter a permissão `instagram_business_basic`.
export async function refreshLongToken(
  token: string,
  fetchFn: FetchFn = fetch,
  nowMs: number = Date.now(),
): Promise<{ accessToken: string; expiresAt: Date }> {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  const long = parseLongToken(await call('refresh', fetchFn, url));
  return { accessToken: long.accessToken, expiresAt: expiresAtFrom(nowMs, long.expiresInSeconds) };
}
