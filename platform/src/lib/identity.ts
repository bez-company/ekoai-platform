// identity.ts: confere o ID token do Identity Platform (SPEC 009). Server-only, runtime Node.
// É o único ponto do app que conversa com o Firebase: depois daqui vale a nossa sessão.
// Com FIREBASE_AUTH_EMULATOR_HOST definido, o firebase-admin fala com o emulador local.

import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { oobCodeFromLink } from './auth-mail-model';
import { logError } from './log';

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

// Token vencido, revogado ou malformado é rotina (a pessoa demorou, saiu de todos os dispositivos).
// Qualquer outro motivo (permissão da conta de serviço, rede, projeto errado) é problema nosso e não
// pode ficar escondido atrás de um 401 genérico.
const ROUTINE_CODES = new Set(['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error', 'auth/invalid-id-token', 'auth/user-disabled', 'auth/user-not-found']);

export class InvalidIdentityError extends Error {
  readonly code: string;
  constructor(message: string, code = '') {
    super(message);
    this.code = code;
  }

  get routine(): boolean {
    return ROUTINE_CODES.has(this.code);
  }
}

// Nome que a pessoa digitou no cadastro (claim `name` do ID token). Só texto curto e limpo.
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || null;
}

// Código de uso único (oobCode) para confirmar o e-mail ou redefinir a senha. O Identity Platform gera; quem monta o link e
// envia é a Ekoai (auth-mail-model.ts, mailer.ts). Precisa de `roles/firebaseauth.admin` na conta do app. Pessoa que não
// existe volta `null` (a rota responde igual para quem existe e para quem não existe).
export async function actionCode(kind: 'verify' | 'reset', email: string): Promise<string | null> {
  const auth = getAuth(identityApp());
  try {
    const link = kind === 'verify' ? await auth.generateEmailVerificationLink(email) : await auth.generatePasswordResetLink(email);
    return oobCodeFromLink(link);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: unknown }).code === 'auth/user-not-found') return null;
    throw e;
  }
}

// A pessoa tem verificação em duas etapas ligada? Lê do provedor (é ele quem sabe). Falha de rede ou de
// permissão volta `null`: a tela diz que não conseguiu ler em vez de afirmar ligada ou desligada.
export async function hasSecondFactor(uid: string): Promise<boolean | null> {
  try {
    const record = await getAuth(identityApp()).getUser(uid);
    return (record.multiFactor?.enrolledFactors.length ?? 0) > 0;
  } catch (e) {
    logError('identity/second-factor', e);
    return null;
  }
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
    const code = e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string' ? (e as { code: string }).code : '';
    throw new InvalidIdentityError(e instanceof Error ? e.message : String(e), code);
  }
}
