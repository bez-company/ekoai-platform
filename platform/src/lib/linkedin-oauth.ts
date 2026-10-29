// linkedin-oauth.ts: as chamadas ao LinkedIn da conexão (SPEC 028, BEZ-423): configuração do app, troca do código por token, leitura
// de quem é a pessoa e renovação. O token e o segredo do app nunca vão para o log nem para o navegador. Server-only.

import {
  API_VERSION,
  REST_URL,
  TOKEN_URL,
  USERINFO_URL,
  ConnectError,
  expiresAtFrom,
  MAX_PAGES,
  hasPageScopes,
  isPermanentFailure,
  missingScopes,
  organizationId,
  parseAcls,
  parsePages,
  parseProfile,
  parseToken,
  type LinkedInPage,
  type LinkedInProfile,
} from './linkedin-oauth-model';
import { log } from './log';

type FetchFn = typeof fetch;

export type LinkedInApp = { clientId: string; clientSecret: string };

// O servidor lê as duas em runtime (Secret Manager). Sem elas a conexão fica indisponível e a tela diz isso.
export function oauthApp(env: Record<string, string | undefined> = process.env): LinkedInApp | null {
  const clientId = env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = env.LINKEDIN_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type ConnectedLinkedIn = {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string | null;
  scopes: string[];
  profile: LinkedInProfile;
  pages: LinkedInPage[]; // as páginas que a pessoa administra (vazio sem os escopos de página)
};

// O LinkedIn recusou ou não respondeu. Só o passo, o status e o código curto do erro: nunca a URL nem o corpo (levam segredo).
export class LinkedInApiError extends Error {
  constructor(
    public readonly step: string,
    public readonly status: number | null,
    public readonly error: string | null = null,
  ) {
    super(`LinkedIn ${step}: ${status ?? 'sem resposta'}`);
  }

  get permanent(): boolean {
    return isPermanentFailure({ status: this.status, error: this.error });
  }
}

async function readJson(res: Response, step: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let error: string | null = null;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      error = typeof body.error === 'string' ? body.error.slice(0, 60) : null;
    } catch {
      /* corpo que não é JSON: fica só o status */
    }
    log('warn', 'linkedin/oauth', 'o LinkedIn recusou o passo', { step, status: res.status, error });
    throw new LinkedInApiError(step, res.status, error);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LinkedInApiError(step, res.status, 'invalid_json');
  }
}

// Falha de rede conta como erro transitório (sem status), para a renovação tentar de novo.
async function call(step: string, fetchFn: FetchFn, input: Parameters<FetchFn>[0], init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(input, init);
  } catch {
    log('warn', 'linkedin/oauth', 'sem resposta do LinkedIn', { step });
    throw new LinkedInApiError(step, null);
  }
  return readJson(res, step);
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  body: new URLSearchParams(fields),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

// Troca o `code` do callback pelo token, confere a permissão de publicar e lê quem é a pessoa.
export async function connectWithCode(
  input: { code: string; redirectUri: string; app: LinkedInApp },
  fetchFn: FetchFn = fetch,
  nowMs: number = Date.now(),
): Promise<ConnectedLinkedIn> {
  const token = parseToken(
    await call('code', fetchFn, TOKEN_URL, form({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, client_id: input.app.clientId, client_secret: input.app.clientSecret })),
  );
  if (missingScopes(token.scopes).length > 0) throw new ConnectError('no_publish');
  const profile = parseProfile(await call('profile', fetchFn, USERINFO_URL, { headers: { Authorization: `Bearer ${token.accessToken}` } }));
  // As páginas só são lidas quando a pessoa concedeu os escopos de página. Falhar aqui não derruba a conexão do perfil: a pessoa
  // conecta e vê que nenhuma página apareceu.
  const pages = hasPageScopes(token.scopes) ? await fetchPages(token.accessToken, fetchFn).catch(() => []) : [];
  return { accessToken: token.accessToken, expiresAt: expiresAtFrom(nowMs, token.expiresInSeconds), refreshToken: token.refreshToken, scopes: token.scopes, profile, pages };
}

// As páginas que a pessoa administra, com o nome de cada uma: a lista de funções (organizationAcls) e, para os nomes, o lookup de
// organizações (que não exige ser administrador).
export async function fetchPages(accessToken: string, fetchFn: FetchFn = fetch): Promise<LinkedInPage[]> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': API_VERSION, 'X-Restli-Protocol-Version': '2.0.0' };
  const acls = await call('pages', fetchFn, `${REST_URL}/organizationAcls?q=roleAssignee&state=APPROVED&count=${MAX_PAGES}`, { headers });
  const urns = parseAcls(acls);
  if (!urns.length) return [];
  const ids = urns.map(organizationId).join(',');
  const lookup = await call('page_names', fetchFn, `${REST_URL}/organizationsLookup?ids=List(${ids})`, { headers }).catch(() => null);
  return parsePages(urns, lookup);
}

export type RefreshedLinkedIn = { accessToken: string; expiresAt: Date; refreshToken: string | null };

// Renova o acesso com o refresh token. O LinkedIn pode devolver um refresh token novo; quando não devolve, vale o anterior.
export async function refreshWithToken(
  refreshToken: string,
  app: LinkedInApp,
  fetchFn: FetchFn = fetch,
  nowMs: number = Date.now(),
): Promise<RefreshedLinkedIn> {
  const token = parseToken(await call('refresh', fetchFn, TOKEN_URL, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret })));
  return { accessToken: token.accessToken, expiresAt: expiresAtFrom(nowMs, token.expiresInSeconds), refreshToken: token.refreshToken ?? refreshToken };
}
