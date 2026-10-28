import { NextResponse } from 'next/server';
import { authProvider } from '@/lib/auth';
import { actionCode } from '@/lib/identity';
import { actionUrl, parseResetBody } from '@/lib/auth-mail-model';
import { getMailer } from '@/lib/mailer';
import { appOrigin } from '@/lib/origin';
import { RULES, clientIp, trustedHopsFrom } from '@/lib/rate-limit-model';
import { hit, tooMany } from '@/lib/rate-limit';
import { apiError, badRequest } from '@/lib/api';

export const runtime = 'nodejs';

// "Esqueci a senha" enviado pela Ekoai (BEZ-430). Pública (quem chama não consegue entrar). Responde igual para e-mail que existe
// e que não existe: a tela não revela quem tem acesso. Sem MAIL_PROVIDER responde `fallback` e o navegador usa o e-mail do Firebase.
export async function POST(req: Request) {
  try {
    if (authProvider() !== 'identity') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
    const ip = clientIp(req.headers.get('x-forwarded-for'), trustedHopsFrom(process.env));
    if (ip) {
      const byIp = await hit(RULES.mailIp, ip);
      if (!byIp.allowed) return tooMany(byIp, 'api/auth/password-reset', RULES.mailIp.bucket);
    }
    const parsed = parseResetBody(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);

    const byEmail = await hit(RULES.resetEmail, parsed.value.email);
    if (!byEmail.allowed) return tooMany(byEmail, 'api/auth/password-reset', RULES.resetEmail.bucket);

    const mailer = getMailer();
    if (!mailer) return NextResponse.json({ ok: true, fallback: true });
    const code = await actionCode('reset', parsed.value.email);
    if (code) await mailer.sendPasswordReset({ to: parsed.value.email, link: actionUrl(appOrigin(req), 'resetPassword', code) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/auth/password-reset');
  }
}
