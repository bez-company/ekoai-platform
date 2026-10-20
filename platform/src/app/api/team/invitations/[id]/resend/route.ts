import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { inviteLink } from '@/lib/invitation-model';
import { resendInvitation } from '@/lib/team';
import { accountOf } from '@/lib/accounts';
import { getMailer } from '@/lib/mailer';
import { appOrigin } from '@/lib/origin';
import { isUuid } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

// Reenviar: o link antigo deixa de valer e a validade volta a 7 dias.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('team.manage');
    const { id } = await params;
    if (!isUuid(id)) return badRequest('Convite inválido. Recarregue a página.');
    const mailer = getMailer(); // configuração errada falha antes de trocar o token
    const invite = await resendInvitation(t, user, id);
    const link = inviteLink(appOrigin(req), invite.token);
    if (!mailer) return NextResponse.json({ id, sent: false, link });
    const account = await accountOf(t.tenantId);
    await mailer.sendInvitation({ to: invite.email, accountName: account?.name ?? '', inviterName: user.name, role: invite.role, link });
    return NextResponse.json({ id, sent: true });
  } catch (e) {
    return apiError(e, 'api/team/invitations/[id]/resend');
  }
}
