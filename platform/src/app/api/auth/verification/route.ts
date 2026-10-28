import { NextResponse } from 'next/server';
import { authProvider } from '@/lib/auth';
import { actionCode, InvalidIdentityError, verifyIdToken } from '@/lib/identity';
import { actionUrl, parseVerificationBody } from '@/lib/auth-mail-model';
import { getMailer } from '@/lib/mailer';
import { appOrigin } from '@/lib/origin';
import { RULES, clientIp, trustedHopsFrom } from '@/lib/rate-limit-model';
import { hit, tooMany } from '@/lib/rate-limit';
import { apiError, badRequest, invalidTokenResponse } from '@/lib/api';

export const runtime = 'nodejs';

// Confirmação de e-mail do cadastro enviada pela Ekoai (BEZ-430). Pública: quem chama acabou de criar o acesso e ainda não
// tem sessão; a prova é o ID token. Sem MAIL_PROVIDER (desenvolvimento e E2E) responde `fallback` e o navegador usa o e-mail
// do próprio Firebase.
export async function POST(req: Request) {
  try {
    if (authProvider() !== 'identity') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
    const ip = clientIp(req.headers.get('x-forwarded-for'), trustedHopsFrom(process.env));
    if (ip) {
      const byIp = await hit(RULES.mailIp, ip);
      if (!byIp.allowed) return tooMany(byIp, 'api/auth/verification', RULES.mailIp.bucket);
    }
    const parsed = parseVerificationBody(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);

    let identity;
    try {
      identity = await verifyIdToken(parsed.value.idToken);
    } catch (e) {
      if (e instanceof InvalidIdentityError) return invalidTokenResponse('api/auth/verification', e);
      throw e;
    }
    if (identity.emailVerified) return NextResponse.json({ ok: true, already: true });
    if (!identity.email) return badRequest('Esta conta não tem e-mail para confirmar.');

    const byEmail = await hit(RULES.verifyEmail, identity.email);
    if (!byEmail.allowed) return tooMany(byEmail, 'api/auth/verification', RULES.verifyEmail.bucket);

    const mailer = getMailer();
    if (!mailer) return NextResponse.json({ ok: true, fallback: true });
    const code = await actionCode('verify', identity.email);
    if (!code) throw new Error('sem código de confirmação para a pessoa que acabou de se cadastrar');
    await mailer.sendVerification({ to: identity.email, name: identity.name, link: actionUrl(appOrigin(req), 'verifyEmail', code, parsed.value.next) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/auth/verification');
  }
}
