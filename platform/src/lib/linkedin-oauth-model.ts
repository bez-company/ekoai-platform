// linkedin-oauth-model.ts: a parte pura da conexão do LinkedIn (SPEC 028, BEZ-423): URL de autorização, leitura do callback, validação
// do formato das respostas do LinkedIn e a decisão de renovar ou avisar. Sem I/O e sem segredo, para testar sem rede. Perfil pessoal
// (OpenID Connect para saber quem é a pessoa e `w_member_social` para publicar no nome dela); a página da empresa fica para depois.
//
// O token de acesso do LinkedIn dura 60 dias. O refresh token só existe para alguns apps (parceiros), então a regra é: se vier,
// renova; se não vier, a Ekoai avisa antes de vencer e, vencido, a conta vira "precisa reconectar".

import { UserError } from './errors';
import { daysUntil } from './instagram-oauth-model';

export const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

// Só o que o app usa. `w_member_social` publica; `openid` e `profile` dizem quem é a pessoa (o `sub` vira o autor do post).
export const REQUIRED_SCOPES = ['w_member_social'] as const;
export const SCOPES = ['openid', 'profile', ...REQUIRED_SCOPES] as const;

// A conexão fica de pé um mês e meio; o aviso e a renovação agem dentro desta janela antes do vencimento.
export const REFRESH_WINDOW_DAYS = 15;

export function buildAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  return url.toString();
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/linkedin/callback`;
}

export type CallbackQuery = { kind: 'code'; code: string; state: string } | { kind: 'denied' } | { kind: 'invalid' };

// O LinkedIn devolve `?code=...&state=...` ou, se a pessoa cancela, `?error=user_cancelled_login` ou `user_cancelled_authorize`.
const DENIED = new Set(['user_cancelled_login', 'user_cancelled_authorize', 'access_denied']);

export function parseCallbackQuery(params: URLSearchParams): CallbackQuery {
  const error = params.get('error');
  if (error) return DENIED.has(error) ? { kind: 'denied' } : { kind: 'invalid' };
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  if (!code || code.length > 2000 || !state || state.length > 200) return { kind: 'invalid' };
  return { kind: 'code', code, state };
}

// O que a tela de redes mostra depois de voltar do LinkedIn (`?li=<chave>`).
export type FlashKey = 'connected' | 'disconnected' | 'denied' | 'invalid' | 'failed' | 'no_publish' | 'taken' | 'unavailable';

export const FLASH: Record<FlashKey, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'LinkedIn conectado. Os posts aprovados já podem ir para ele.' },
  disconnected: { tone: 'ok', text: 'LinkedIn desconectado. O acesso guardado foi apagado.' },
  denied: { tone: 'warn', text: 'A conexão foi cancelada no LinkedIn. Clique em Conectar para tentar de novo.' },
  invalid: { tone: 'warn', text: 'A conexão expirou ou veio incompleta. Clique em Conectar para começar de novo.' },
  failed: { tone: 'warn', text: 'Não deu para concluir a conexão agora. Tente de novo em instantes; se continuar, avise o suporte.' },
  no_publish: { tone: 'warn', text: 'A permissão de publicar no seu nome não foi concedida. Conecte de novo e aceite "Publicar no seu nome".' },
  taken: { tone: 'warn', text: 'Esse perfil do LinkedIn já está conectado a outra conta da Ekoai. Desconecte lá primeiro.' },
  unavailable: { tone: 'warn', text: 'A conexão com o LinkedIn ainda não está ativa neste ambiente. Avise o suporte.' },
};

export function isFlashKey(value: unknown): value is FlashKey {
  return typeof value === 'string' && value in FLASH;
}

// Erro de conexão que a pessoa entende e sabe corrigir: vira `?li=<chave>` na volta.
export class ConnectError extends UserError {
  constructor(public readonly flash: FlashKey) {
    super(FLASH[flash].text);
  }
}

// ── Respostas do LinkedIn (dado externo: valida o formato antes de usar) ────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('resposta do LinkedIn fora do formato');
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, field: string, max = 4000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`resposta do LinkedIn sem ${field}`);
  return value;
}

export type LinkedInToken = {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string | null;
  refreshExpiresInSeconds: number | null;
  scopes: string[];
};

// POST /oauth/v2/accessToken: `scope` vem separado por vírgula (ou espaço, conforme a versão). `refresh_token` só existe em alguns apps.
export function parseToken(json: unknown): LinkedInToken {
  const body = asRecord(json);
  const expires = Number(body.expires_in);
  if (!Number.isFinite(expires) || expires <= 0) throw new Error('resposta do LinkedIn sem expires_in');
  const refreshExpires = Number(body.refresh_token_expires_in);
  const scope = typeof body.scope === 'string' ? body.scope : '';
  return {
    accessToken: nonEmpty(body.access_token, 'access_token'),
    expiresInSeconds: Math.floor(expires),
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token.slice(0, 4000) : null,
    refreshExpiresInSeconds: Number.isFinite(refreshExpires) && refreshExpires > 0 ? Math.floor(refreshExpires) : null,
    scopes: scope.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
  };
}

export type LinkedInProfile = { memberId: string; name: string | null };

// GET /v2/userinfo (OpenID Connect): `sub` é o id da pessoa e vira o autor do post (`urn:li:person:<sub>`).
export function parseProfile(json: unknown): LinkedInProfile {
  const body = asRecord(json);
  const given = typeof body.given_name === 'string' ? body.given_name : '';
  const family = typeof body.family_name === 'string' ? body.family_name : '';
  const full = typeof body.name === 'string' && body.name ? body.name : `${given} ${family}`.trim();
  return { memberId: nonEmpty(body.sub, 'sub', 100), name: full ? full.slice(0, 100) : null };
}

export const authorUrn = (memberId: string): string => `urn:li:person:${memberId}`;

// Falta a permissão de publicar? A pessoa pode desmarcar na tela do LinkedIn.
export function missingScopes(granted: readonly string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}

// O que o evento `linkedin_connected` leva: só se o LinkedIn devolveu refresh token (decide se o acesso renova sozinho ou se a
// pessoa precisa reconectar a cada ~60 dias). Nunca o token.
export const connectedProps = (connected: { refreshToken: string | null }): { has_refresh: boolean } => ({ has_refresh: connected.refreshToken !== null });

export function expiresAtFrom(nowMs: number, expiresInSeconds: number): Date {
  return new Date(nowMs + expiresInSeconds * 1000);
}

// ── Renovação e aviso ────────────────────────────────────────────────────────────────────────────

export type RefreshCandidate = { status: string; expiresAt: Date | string | null; hasRefreshToken: boolean; expiringNotified: boolean };

// skip: ainda longe de vencer; refresh: renovar agora (há refresh token); warn: vai vencer e não há como renovar, avisa uma vez;
// expired: já venceu, não dá para renovar, a conta vira "precisa reconectar".
export type RefreshDecision = 'skip' | 'refresh' | 'warn' | 'expired';

export const EXPIRING_REASON = 'expiring_soon';

export function refreshDecision(c: RefreshCandidate, nowMs: number): RefreshDecision {
  if (c.status !== 'active' || !c.expiresAt) return 'skip';
  const left = daysUntil(c.expiresAt, nowMs);
  if (left === null) return 'skip';
  if (new Date(c.expiresAt).getTime() <= nowMs) return 'expired';
  if (left > REFRESH_WINDOW_DAYS) return 'skip';
  if (c.hasRefreshToken) return 'refresh';
  return c.expiringNotified ? 'skip' : 'warn';
}

// Erro do LinkedIn sem o token: permanente quando o refresh token foi recusado, vencido ou revogado (a conta precisa reconectar).
// Na dúvida é passageiro: limite de taxa e erro 5xx tentam de novo no dia seguinte, e o prazo cuida do resto (`expired`).
export type LinkedInFailure = { status: number | null; error: string | null };

const PERMANENT_ERRORS = new Set(['invalid_grant', 'invalid_token', 'invalid_request', 'unauthorized_client', 'access_denied']);

export function isPermanentFailure(f: LinkedInFailure): boolean {
  if (f.status === 401) return true;
  return f.status === 400 && f.error !== null && PERMANENT_ERRORS.has(f.error);
}
