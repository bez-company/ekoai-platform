import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { createAccountWithInvite } from '@/lib/console-accounts';
import { consoleError } from '@/lib/console-api';
import { parseCreateConsoleAccount } from '@/lib/console-model';
import { inviteLink } from '@/lib/invitation-model';
import { getMailer } from '@/lib/mailer';
import { appOrigin } from '@/lib/origin';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Criar conta pelo console (SPEC 011 R9): é o caminho de entrada enquanto SIGNUP_MODE=invite. A conta
// nasce pausada e o primeiro administrador recebe o convite. Sem provedor de e-mail (hoje), a resposta
// traz o link para copiar; o token só existe aqui e no link, o banco guarda o hash.
export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = parseCreateConsoleAccount(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const mailer = getMailer(); // configuração errada falha antes de criar a conta
    const created = await createAccountWithInvite(parsed.value, admin.user.id);
    const link = inviteLink(appOrigin(req), created.token);
    if (!mailer) return NextResponse.json({ id: created.id, sent: false, link, expiresAt: created.expiresAt }, { status: 201 });
    await mailer.sendInvitation({ to: parsed.value.email, accountName: parsed.value.name, inviterName: admin.user.name, role: 'admin', link });
    return NextResponse.json({ id: created.id, sent: true, expiresAt: created.expiresAt }, { status: 201 });
  } catch (e) {
    return consoleError(e, 'api/console/accounts');
  }
}
