// Sessão assinada (HMAC) em cookie httpOnly, nos dois modos de login (SPEC 009):
//   senha única (AUTH_PROVIDER=password): token = <tenant>.<expira>.<assinatura>
//   por pessoa  (AUTH_PROVIDER=identity): token = u.<pessoa>.<tenant>.<versão>.<expira>.<assinatura>
// Usa Web Crypto (disponível no edge middleware e nos route handlers), sem node:crypto, pra
// rodar igual nos dois runtimes. Aqui só se confere assinatura e validade; quem confere no banco
// se a pessoa ainda é membro e se a versão bate é session.ts.

import { isTenantId } from './tenant';

// `__session` é o único cookie que o Firebase Hosting repassa ao Cloud Run (ADR 0020): não renomear.
export const SESSION_COOKIE = '__session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias (senha única)
export const USER_SESSION_TTL_S = 7 * 24 * 60 * 60; // 7 dias (por pessoa)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AuthProvider = 'password' | 'identity';

export function authProvider(): AuthProvider {
  const v = process.env.AUTH_PROVIDER || 'password';
  if (v !== 'password' && v !== 'identity') throw new Error(`AUTH_PROVIDER inválido: ${v}`);
  return v;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET ausente');
  return s;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

// Tenant da instalação de senha única. Com o login por usuário, vem da membership. Sem queda
// padrão (ADR 0010): instalação sem TENANT_ID válido não emite sessão.
export function installTenantId(): string {
  const id = process.env.TENANT_ID;
  if (!isTenantId(id)) throw new Error('TENANT_ID ausente ou inválido na instalação de senha única');
  return id;
}

export type Session = { tenantId: string; userId: string | null; sessionVersion: number | null };

// token = <tenant>.<expiraEm>.<assinatura>. O tenant entra na assinatura: trocar o tenant no
// cookie invalida a sessão. Token antigo (sem tenant) não valida e leva de volta ao login.
export async function createSessionToken(tenantId: string): Promise<string> {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmac(`${tenantId}.${exp}`);
  return `${tenantId}.${exp}.${sig}`;
}

export async function createUserSessionToken(s: { userId: string; tenantId: string; sessionVersion: number }): Promise<string> {
  if (!UUID_RE.test(s.userId) || !isTenantId(s.tenantId) || !(Number.isInteger(s.sessionVersion) && s.sessionVersion > 0)) {
    throw new Error('sessão por pessoa com dado inválido');
  }
  const payload = `u.${s.userId}.${s.tenantId}.${s.sessionVersion}.${Date.now() + USER_SESSION_TTL_S * 1000}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length === 6 && parts[0] === 'u') return verifyUserToken(parts);
  if (parts.length !== 3) return null;
  const [tenantId, exp, sig] = parts;
  if (!isTenantId(tenantId) || !exp || !sig) return null;
  if (!(Number(exp) > Date.now())) return null;
  if (!safeEqual(await hmac(`${tenantId}.${exp}`), sig)) return null;
  return { tenantId, userId: null, sessionVersion: null };
}

async function verifyUserToken(parts: string[]): Promise<Session | null> {
  const [, userId, tenantId, version, exp, sig] = parts;
  const sessionVersion = Number(version);
  if (!UUID_RE.test(userId) || !isTenantId(tenantId) || !(Number.isInteger(sessionVersion) && sessionVersion > 0)) return null;
  if (!(Number(exp) > Date.now())) return null;
  if (!safeEqual(await hmac(parts.slice(0, 5).join('.')), sig)) return null;
  return { tenantId, userId, sessionVersion };
}

export const sessionCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.PLATFORM_PASSWORD;
  if (!expected) throw new Error('PLATFORM_PASSWORD ausente');
  return safeEqual(input, expected);
}

// Comparação em tempo constante (não para no primeiro byte diferente).
export function safeEqual(input: string, expected: string): boolean {
  const a = new TextEncoder().encode(input);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// usado em fromB64url indiretamente; exportado caso precise validar payloads
export { fromB64url };
