// cron-auth.ts: quem pode chamar /api/cron/*. Duas formas, as duas falham fechadas:
//  1. Cloud Scheduler: token OIDC no Authorization. Confere a assinatura do Google, o público
//     (a URL da plataforma, CRON_OIDC_AUDIENCE) e se o e-mail é o da conta do Scheduler
//     (CRON_OIDC_EMAIL). Sem essas duas variáveis, o caminho OIDC fica desligado.
//  2. Bearer <CRON_SECRET>, para chamada manual de depuração.
// Segredo na query string não é aceito (vaza em log).

import { OAuth2Client } from 'google-auth-library';
import { safeEqual } from './auth';

export type OidcVerifier = (token: string, audience: string) => Promise<{ email?: string; email_verified?: boolean } | undefined>;

const client = new OAuth2Client();

const googleVerifier: OidcVerifier = async (token, audience) => {
  const ticket = await client.verifyIdToken({ idToken: token, audience });
  return ticket.getPayload();
};

export async function isCronAuthorized(req: Request, verify: OidcVerifier = googleVerifier): Promise<boolean> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);

  const secret = process.env.CRON_SECRET;
  if (secret && safeEqual(token, secret)) return true;

  const audience = process.env.CRON_OIDC_AUDIENCE;
  const email = process.env.CRON_OIDC_EMAIL;
  if (!audience || !email) return false;
  try {
    const payload = await verify(token, audience);
    return payload?.email_verified === true && payload.email === email;
  } catch {
    return false;
  }
}
