// identity.ts: confere o ID token do Identity Platform (SPEC 009). Server-only, runtime Node.
// É o único ponto do app que conversa com o Firebase: depois daqui vale a nossa sessão.
// Com FIREBASE_AUTH_EMULATOR_HOST definido, o firebase-admin fala com o emulador local.

import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type Identity = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  authTime: number;
  secondFactor: string | null;
  name: string | null;
};

const APP_NAME = 'identity';

function identityApp(): App {
  const projectId = process.env.IDENTITY_PROJECT_ID;
  if (!projectId) throw new Error('IDENTITY_PROJECT_ID ausente');
  return getApps().find((a) => a.name === APP_NAME) ?? initializeApp({ projectId }, APP_NAME);
}

export class InvalidIdentityError extends Error {}

// Nome que a pessoa digitou no cadastro (claim `name` do ID token). Só texto curto e limpo.
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || null;
}

// Assinatura, validade e revogação. Qualquer falha vira InvalidIdentityError (a rota responde
// 401 sem detalhe); o motivo técnico fica na mensagem para o log.
export async function verifyIdToken(idToken: string): Promise<Identity> {
  try {
    const t = await getAuth(identityApp()).verifyIdToken(idToken, true);
    return {
      uid: t.uid,
      email: typeof t.email === 'string' ? t.email.toLowerCase() : null,
      emailVerified: t.email_verified === true,
      authTime: t.auth_time,
      secondFactor: t.firebase?.sign_in_second_factor ?? null,
      name: cleanName(t.name),
    };
  } catch (e) {
    throw new InvalidIdentityError(e instanceof Error ? e.message : String(e));
  }
}
