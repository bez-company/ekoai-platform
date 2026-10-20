import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { accountOf, idpUidOf } from '@/lib/accounts';
import { deleteAccount } from '@/lib/account-deletion';
import { REAUTH_MESSAGES, confirmationMatches, parseDeleteBody, reauthRefusal } from '@/lib/account-deletion-model';
import { InvalidIdentityError, verifyIdToken } from '@/lib/identity';
import { getMailer } from '@/lib/mailer';
import { SESSION_COOKIE } from '@/lib/auth';
import { log } from '@/lib/log';
import { apiError, badRequest, invalidTokenResponse } from '@/lib/api';

// Excluir a conta, de forma definitiva (SPEC 011 R8). Só administrador (account.delete) e só com
// duas provas além da sessão: o nome da conta e um ID token de uma reautenticação com o segundo
// fator de poucos minutos atrás. Apaga em cascata, tira os arquivos do bucket e encerra a sessão.
export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('account.delete');
    const parsed = parseDeleteBody(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);

    const account = await accountOf(t.tenantId);
    if (!account) return badRequest('Conta não encontrada. Recarregue a página.');
    if (!confirmationMatches(parsed.value.confirmName, account.name)) return badRequest('O nome digitado não é o da conta. Confira e tente de novo.');

    let identity;
    try {
      identity = await verifyIdToken(parsed.value.idToken);
    } catch (e) {
      if (e instanceof InvalidIdentityError) return invalidTokenResponse('api/account/delete', e);
      throw e;
    }
    const refusal = reauthRefusal(identity, await idpUidOf(user.id));
    if (refusal) return NextResponse.json({ error: REAUTH_MESSAGES[refusal], code: refusal }, { status: refusal === 'stale' ? 401 : 403 });

    const deleted = await deleteAccount({ tenantId: t.tenantId, actorUserId: user.id, kind: account.kind });

    // Aviso aos outros administradores: melhor esforço, a conta já foi excluída.
    try {
      const mailer = getMailer();
      if (mailer) {
        await Promise.all(deleted.adminEmails.map((to) => mailer.sendAccountDeleted({ to, accountName: account.name, deletedByName: user.name }).catch((e) => log('warn', 'api/account/delete', 'não avisou um administrador', { error: e instanceof Error ? e.message : String(e) }))));
      }
    } catch (e) {
      log('warn', 'api/account/delete', 'aviso de exclusão não enviado', { error: e instanceof Error ? e.message : String(e) });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    return apiError(e, 'api/account/delete');
  }
}
