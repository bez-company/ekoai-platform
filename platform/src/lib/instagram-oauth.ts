// instagram-oauth.ts: as chamadas à Meta da conexão do Instagram (SPEC 011 R5): configuração do app,
// troca do código por token de longa duração e leitura do perfil. O token e o segredo do app nunca
// vão para o log nem para o navegador. Server-only.

import {
  EXCHANGE_URL,
  GRAPH_URL,
  TOKEN_URL,
  ConnectError,
  expiresAtFrom,
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

async function readJson(res: Response, step: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    // Só o código e a mensagem da Meta: nunca a URL (leva segredo) nem o corpo inteiro.
    let reason = '';
    try {
      const body = JSON.parse(text) as { error_message?: string; error?: { message?: string } };
      reason = String(body.error_message ?? body.error?.message ?? '').slice(0, 200);
    } catch {
      /* corpo que não é JSON: fica só o status */
    }
    log('warn', 'instagram/oauth', 'a Meta recusou o passo', { step, status: res.status, reason });
    throw new Error(`Meta ${step}: ${res.status}`);
  }
  return parseJsonKeepingIds(text);
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
    await readJson(await fetchFn(TOKEN_URL, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 'code'),
  );
  if (missingScopes(short.permissions).length > 0) throw new ConnectError('no_publish');

  const exchange = new URL(EXCHANGE_URL);
  exchange.searchParams.set('grant_type', 'ig_exchange_token');
  exchange.searchParams.set('client_secret', input.app.appSecret);
  exchange.searchParams.set('access_token', short.accessToken);
  const long = parseLongToken(await readJson(await fetchFn(exchange), 'exchange'));

  const me = new URL(`${GRAPH_URL}/me`);
  me.searchParams.set('fields', 'user_id,username,account_type');
  me.searchParams.set('access_token', long.accessToken);
  const profile = parseProfile(await readJson(await fetchFn(me), 'profile'));
  if (!isProfessional(profile)) throw new ConnectError('not_professional');

  return {
    accessToken: long.accessToken,
    expiresAt: expiresAtFrom(nowMs, long.expiresInSeconds),
    scopes: short.permissions,
    profile,
  };
}
