// auth-mail-model.ts: os e-mails de confirmação de endereço e de redefinição de senha, que a Ekoai envia pelo Gmail em vez
// do Firebase (BEZ-430). Puro: o formato do link para a nossa página /acao e a validação dos corpos das rotas.

import { isEmail, safeNext } from './auth-flow';
import { isIdTokenShape } from './route-input';

export type ActionMode = 'verifyEmail' | 'resetPassword';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// O Identity Platform gera o código de uso único (oobCode); o link que vai no e-mail é o nosso, não o do firebaseapp.com.
export function actionUrl(origin: string, mode: ActionMode, oobCode: string, next?: string | null): string {
  const url = new URL('/acao', origin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('oobCode', oobCode);
  const safe = next ? safeNext(next, '') : '';
  if (safe) url.searchParams.set('next', safe);
  return url.toString();
}

// Tira o oobCode do link que o Admin SDK devolve (`https://<projeto>.firebaseapp.com/__/auth/action?...&oobCode=...`).
export function oobCodeFromLink(link: string): string | null {
  try {
    const code = new URL(link).searchParams.get('oobCode');
    return code && /^[A-Za-z0-9_-]{10,512}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

const obj = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {});

export function parseVerificationBody(body: unknown): Parsed<{ idToken: string; next: string | null }> {
  const b = obj(body);
  if (!isIdTokenShape(b.idToken)) return { ok: false, error: 'Login inválido. Entre de novo.' };
  const next = typeof b.next === 'string' ? safeNext(b.next, '') : '';
  return { ok: true, value: { idToken: b.idToken, next: next || null } };
}

export function parseResetBody(body: unknown): Parsed<{ email: string }> {
  const b = obj(body);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!isEmail(email)) return { ok: false, error: 'Digite um e-mail completo, como ana@empresa.com.br.' };
  return { ok: true, value: { email } };
}
