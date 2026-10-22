// meta-signed-request.ts: a prova dos callbacks da Meta (SPEC 011 R5.4, BEZ-215). Puro, sem I/O.
//
// A Meta manda `signed_request=<assinatura>.<payload>` no corpo (form). As duas partes vêm em base64url;
// a assinatura é o HMAC-SHA256 do payload (o texto base64url, como chegou) com o segredo do app. Só o
// que passa aqui chega ao banco: assinatura errada, algoritmo diferente ou payload estranho viram recusa.
// Docs: developers.facebook.com/docs/facebook-login/guides/advanced/oidc-token (signed_request) e
// developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignedRequest = { userId: string; issuedAt: number | null };

export type SignedResult = { ok: true; value: SignedRequest } | { ok: false; reason: 'missing' | 'format' | 'signature' | 'algorithm' | 'payload' };

const B64URL = /^[A-Za-z0-9_-]+$/;

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function parseSignedRequest(raw: unknown, appSecret: string): SignedResult {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'missing' };
  if (raw.length > 4096) return { ok: false, reason: 'format' };
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts.every((p) => B64URL.test(p))) return { ok: false, reason: 'format' };
  const [sig, payload] = parts;

  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const given = fromB64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };

  let data: unknown;
  try {
    data = JSON.parse(fromB64url(payload).toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'payload' };
  const d = data as Record<string, unknown>;
  if (typeof d.algorithm !== 'string' || d.algorithm.toUpperCase() !== 'HMAC-SHA256') return { ok: false, reason: 'algorithm' };
  const userId = typeof d.user_id === 'string' ? d.user_id : typeof d.user_id === 'number' ? String(d.user_id) : '';
  if (!/^[0-9A-Za-z_-]{1,100}$/.test(userId)) return { ok: false, reason: 'payload' };
  const issuedAt = typeof d.issued_at === 'number' && Number.isFinite(d.issued_at) ? d.issued_at : null;
  return { ok: true, value: { userId, issuedAt } };
}

// O corpo do callback é form-urlencoded; só o campo signed_request importa.
export function signedRequestFromBody(body: string): string | null {
  return new URLSearchParams(body).get('signed_request');
}

// Código de confirmação: aleatório, legível na página de status, sem dado da pessoa.
export const CONFIRMATION_CODE = /^[A-Za-z0-9_-]{16,64}$/;

export function isConfirmationCode(v: unknown): v is string {
  return typeof v === 'string' && CONFIRMATION_CODE.test(v);
}
