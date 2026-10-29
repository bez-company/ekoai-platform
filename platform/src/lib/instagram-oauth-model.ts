// instagram-oauth-model.ts: a parte pura da conexão do Instagram (SPEC 011 R5): URL de autorização,
// proteção contra CSRF e validação do formato das respostas da Meta. Sem I/O e sem segredo, para
// testar sem rede. Instagram Login (não Facebook Login): não exige Página do Facebook.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { UserError } from './errors';

export const GRAPH_VERSION = 'v21.0';
export const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const GRAPH_URL = `https://graph.instagram.com/${GRAPH_VERSION}`;
export const EXCHANGE_URL = 'https://graph.instagram.com/access_token';

// Só o que o app usa (a Meta reprova pedido a mais no App Review). As obrigatórias publicam o post;
// a de insights (alcance, salvamentos, BEZ-264) é opcional: quem negar conecta, só sem esses números.
export const REQUIRED_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'] as const;
export const OPTIONAL_SCOPES = ['instagram_business_manage_insights'] as const;
export const SCOPES = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES] as const;

export const STATE_TTL_SECONDS = 10 * 60;

// Quanto falta para o token vencer e a conta pedir nova autorização (token de 60 dias).
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', input.state);
  // Sempre mostra o login: quem administra várias contas escolhe qual conectar.
  url.searchParams.set('force_reauth', 'true');
  return url.toString();
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/instagram/callback`;
}

// O `state` não usa cookie: o Firebase Hosting só repassa `__session` ao Cloud Run (ADR 0020), então um
// cookie próprio nunca chegaria ao callback. O `state` é assinado com o segredo do app (HMAC) e amarrado à
// empresa que iniciou o fluxo: um `state` de outra empresa, adulterado ou vencido não passa.
function stateSignature(secret: string, tenantId: string, nonce: string, expiresAt: string): Buffer {
  return createHmac('sha256', secret).update(`${tenantId}.${nonce}.${expiresAt}`).digest();
}

export function createState(input: { tenantId: string; secret: string; now?: number; nonce?: string }): string {
  const nonce = input.nonce ?? randomBytes(12).toString('hex');
  const expiresAt = String(Math.floor((input.now ?? Date.now()) / 1000) + STATE_TTL_SECONDS);
  const signature = stateSignature(input.secret, input.tenantId, nonce, expiresAt).toString('hex');
  return `${nonce}.${expiresAt}.${signature}`;
}

export function stateValid(state: string | null | undefined, input: { tenantId: string; secret: string; now?: number }): boolean {
  const [nonce, expiresAt, signature, ...rest] = (state ?? '').split('.');
  if (!nonce || !expiresAt || !signature || rest.length > 0 || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) < Math.floor((input.now ?? Date.now()) / 1000)) return false;
  const expected = stateSignature(input.secret, input.tenantId, nonce, expiresAt);
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type CallbackQuery =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'denied' }
  | { kind: 'invalid' };

// A Meta devolve `?code=...&state=...` ou, se a pessoa recusa, `?error=access_denied&...`.
export function parseCallbackQuery(params: URLSearchParams): CallbackQuery {
  if (params.get('error')) return params.get('error') === 'access_denied' ? { kind: 'denied' } : { kind: 'invalid' };
  const code = params.get('code')?.replace(/#_$/, '') ?? '';
  const state = params.get('state') ?? '';
  if (!code || code.length > 2000 || !state || state.length > 200) return { kind: 'invalid' };
  return { kind: 'code', code, state };
}

// O que a tela de redes mostra depois de voltar da Meta (`?ig=<chave>`).
export type FlashKey = 'connected' | 'denied' | 'invalid' | 'failed' | 'not_professional' | 'no_publish' | 'limit' | 'networks' | 'taken' | 'unavailable' | 'disconnected';

export const FLASH: Record<FlashKey, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'Instagram conectado. Os posts aprovados já podem ir para ele.' },
  disconnected: { tone: 'ok', text: 'Instagram desconectado. O acesso guardado foi apagado.' },
  denied: { tone: 'warn', text: 'A conexão foi cancelada no Instagram. Clique em Conectar para tentar de novo.' },
  invalid: { tone: 'warn', text: 'A conexão expirou ou veio incompleta. Clique em Conectar para começar de novo.' },
  failed: { tone: 'warn', text: 'Não deu para concluir a conexão agora. Tente de novo em instantes; se continuar, avise o suporte.' },
  not_professional: {
    tone: 'warn',
    text: 'Essa conta é pessoal. No app do Instagram, vá em Configurações, Tipo de conta e ferramentas, e mude para conta profissional. Depois conecte de novo.',
  },
  no_publish: { tone: 'warn', text: 'A permissão de publicar não foi concedida. Conecte de novo e deixe todas as permissões marcadas.' },
  limit: { tone: 'warn', text: 'O plano da conta não inclui mais contas de Instagram. Desconecte uma ou mude de plano.' },
  networks: { tone: 'warn', text: 'O plano da conta não inclui mais redes. Desconecte uma rede ou mude de plano para conectar o Instagram.' },
  taken: { tone: 'warn', text: 'Esse Instagram já está conectado a outra conta da Ekoai. Desconecte lá primeiro.' },
  unavailable: { tone: 'warn', text: 'A conexão com o Instagram ainda não está ativa neste ambiente. Avise o suporte.' },
};

export function isFlashKey(value: unknown): value is FlashKey {
  return typeof value === 'string' && value in FLASH;
}

// ── Respostas da Meta (dado externo: valida o formato antes de usar) ───────────────────────────

// Os ids do Instagram passam de 2^53: lidos como número perdem dígitos. Vira texto antes do parse.
export function parseJsonKeepingIds(text: string): unknown {
  return JSON.parse(text.replace(/"(user_id|id)"\s*:\s*(\d{10,})/g, '"$1":"$2"'));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('resposta da Meta fora do formato');
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, field: string, max = 4000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`resposta da Meta sem ${field}`);
  return value;
}

export type ShortToken = { accessToken: string; userId: string | null; permissions: string[] };

// POST /oauth/access_token devolve o objeto direto ou dentro de `data: [..]`, conforme a versão.
export function parseShortToken(json: unknown): ShortToken {
  let body = asRecord(json);
  if (Array.isArray(body.data)) body = asRecord(body.data[0]);
  const perms = body.permissions;
  const permissions = Array.isArray(perms)
    ? perms.filter((p): p is string => typeof p === 'string')
    : typeof perms === 'string'
      ? perms.split(',').map((p) => p.trim()).filter(Boolean)
      : [];
  return {
    accessToken: nonEmpty(body.access_token, 'access_token'),
    userId: typeof body.user_id === 'string' && body.user_id ? body.user_id : null,
    permissions,
  };
}

export type LongToken = { accessToken: string; expiresInSeconds: number };

export function parseLongToken(json: unknown): LongToken {
  const body = asRecord(json);
  const expires = Number(body.expires_in);
  if (!Number.isFinite(expires) || expires <= 0) throw new Error('resposta da Meta sem expires_in');
  return { accessToken: nonEmpty(body.access_token, 'access_token'), expiresInSeconds: Math.floor(expires) };
}

export type InstagramProfile = { userId: string; username: string | null; accountType: string };

export function parseProfile(json: unknown): InstagramProfile {
  const body = asRecord(json);
  const userId = typeof body.user_id === 'string' && body.user_id ? body.user_id : typeof body.id === 'string' ? body.id : '';
  return {
    userId: nonEmpty(userId, 'user_id', 100),
    username: typeof body.username === 'string' && body.username ? body.username.slice(0, 100) : null,
    accountType: typeof body.account_type === 'string' ? body.account_type.toUpperCase() : '',
  };
}

const PROFESSIONAL = new Set(['BUSINESS', 'MEDIA_CREATOR', 'CREATOR']);

export function isProfessional(profile: InstagramProfile): boolean {
  return PROFESSIONAL.has(profile.accountType);
}

// Falta alguma permissão que o app precisa? A pessoa pode desmarcar uma na tela da Meta.
// Só as obrigatórias barram a conexão.
export function missingScopes(granted: readonly string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}

export function expiresAtFrom(nowMs: number, expiresInSeconds: number): Date {
  return new Date(nowMs + expiresInSeconds * 1000);
}

// Dias até vencer, para a tela avisar antes de a conta travar. Nunca negativo.
export function daysUntil(expiresAt: Date | string | null, nowMs: number): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - nowMs;
  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / DAY_MS));
}

// ── Renovação do token (SPEC 011 R5.3) ────────────────────────────────────────────────────────

// O token dura 60 dias; a renovação roda todo dia e age só dentro desta janela antes do vencimento.
export const REFRESH_WINDOW_DAYS = 15;
// A Meta só renova token com pelo menos 24 horas de vida.
export const MIN_TOKEN_AGE_MS = DAY_MS;

export type RefreshCandidate = {
  status: string;
  expiresAt: Date | string | null;
  refreshedAt: Date | string | null;
  connectedAt: Date | string | null;
};

// skip: ainda longe de vencer (ou sem prazo conhecido); wait: dentro da janela, mas novo demais para a
// Meta renovar; refresh: renovar agora; expired: já venceu, não tem como renovar, pede reconexão.
export type RefreshDecision = 'skip' | 'wait' | 'refresh' | 'expired';

export function refreshDecision(c: RefreshCandidate, nowMs: number): RefreshDecision {
  if (c.status !== 'active' || !c.expiresAt) return 'skip';
  const expires = new Date(c.expiresAt).getTime();
  if (Number.isNaN(expires)) return 'skip';
  if (expires <= nowMs) return 'expired';
  if (expires - nowMs > REFRESH_WINDOW_DAYS * DAY_MS) return 'skip';
  const since = new Date(c.refreshedAt ?? c.connectedAt ?? 0).getTime();
  return Number.isNaN(since) || nowMs - since < MIN_TOKEN_AGE_MS ? 'wait' : 'refresh';
}

// Erro da Meta sem o token: `permanent` só para token inválido, vencido ou retirado pela pessoa (a conta
// precisa ser reconectada). Na dúvida é passageiro: limite de taxa também chega como HTTP 400
// OAuthException (códigos 4, 17, 32, 613), e marcar uma conta saudável como desconectada é pior que
// tentar de novo no dia seguinte (se o token de fato vencer, o prazo cuida: `expired`).
export type MetaFailure = { status: number | null; code: number | null; type: string | null };

// 190 e os subcódigos de token (458 a 467) chegam como 190; 102 é sessão inválida.
const PERMANENT_CODES = new Set([102, 190, 458, 459, 460, 463, 464, 467]);

export function isPermanentMetaFailure(f: MetaFailure): boolean {
  return f.code !== null && PERMANENT_CODES.has(f.code);
}

// Erro de conexão que a pessoa entende e sabe corrigir: vira `?ig=<chave>` na volta.
export class ConnectError extends UserError {
  constructor(public readonly flash: FlashKey) {
    super(FLASH[flash].text);
  }
}
