import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { requireUserPermission } from '@/lib/session';
import { parseCreateInvitation, inviteLink } from '@/lib/invitation-model';
import { createInvitation } from '@/lib/team';
import { accountOf } from '@/lib/accounts';
import { getMailer } from '@/lib/mailer';
import { appOrigin } from '@/lib/origin';
import { apiError, badRequest } from '@/lib/api';

// Convidar pessoa. Com provedor de e-mail configurado o link vai por e-mail; sem ele (hoje), a
// resposta traz o link para quem convidou copiar. O token só existe aqui e no link: o banco
// guarda o hash.
export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('team.manage');
    const parsed = parseCreateInvitation(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const mailer = getMailer(); // configuração errada falha antes de criar o convite
    const { id, token } = await createInvitation(t, user, parsed.value);
    const link = inviteLink(appOrigin(req), token);
    await track(t.tenantId, 'invitation_sent', { role: parsed.value.role, by_email: Boolean(mailer) });
    if (!mailer) return NextResponse.json({ id, sent: false, link }, { status: 201 });
    const account = await accountOf(t.tenantId);
    await mailer.sendInvitation({ to: parsed.value.email, accountName: account?.name ?? '', inviterName: user.name, role: parsed.value.role, link });
    return NextResponse.json({ id, sent: true }, { status: 201 });
  } catch (e) {
    return apiError(e, 'api/team/invitations');
  }
}
