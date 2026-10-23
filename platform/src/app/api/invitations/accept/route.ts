import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { SESSION_COOKIE, USER_SESSION_TTL_S, authProvider, createUserSessionToken, sessionCookie } from '@/lib/auth';
import { InvalidIdentityError, verifyIdToken } from '@/lib/identity';
import { identityRefusal, membershipRefusal, type LoginRefusal } from '@/lib/login-policy';
import { acceptFailure, hashInviteToken, parseAcceptInvitation } from '@/lib/invitation-model';
import { acceptInvitation, findOrLinkUser, markLogin, membershipsOf } from '@/lib/accounts';
import { apiError, badRequest, invalidTokenResponse } from '@/lib/api';
import { RULES, clientIp, trustedHopsFrom } from '@/lib/rate-limit-model';
import { hit, tooMany } from '@/lib/rate-limit';
import { ROLE_COPY } from '@/lib/auth-flow';
import { notify } from '@/lib/notifications';
import { tenantDb } from '@/lib/tenant-db';

export const runtime = 'nodejs';

function refuse(r: { status: number; code: string; error: string }): NextResponse {
  return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
}

// Aceitar convite. Rota pública: quem chama pode ser alguém que acabou de criar o acesso e ainda
// não tem conta; a prova é o ID token (e-mail verificado, login recente), e o convite só vale
// para o e-mail dele. O banco decide tudo de forma atômica (app.accept_invitation).
export async function POST(req: Request) {
  try {
    if (authProvider() !== 'identity') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
    // Limite por IP antes de olhar o token, e por e-mail depois de verificá-lo (BEZ-29).
    const ip = clientIp(req.headers.get('x-forwarded-for'), trustedHopsFrom(process.env));
    if (ip) {
      const byIp = await hit(RULES.acceptIp, ip);
      if (!byIp.allowed) return tooMany(byIp, 'api/invitations/accept', RULES.acceptIp.bucket);
    }
    const parsed = parseAcceptInvitation(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);

    let identity;
    try {
      identity = await verifyIdToken(parsed.value.idToken);
    } catch (e) {
      if (e instanceof InvalidIdentityError) return invalidTokenResponse('api/invitations/accept', e);
      throw e;
    }
    const early = identityRefusal(identity, Math.floor(Date.now() / 1000));
    if (early) return refuse(early);
    if (identity.email) {
      const byEmail = await hit(RULES.acceptEmail, identity.email);
      if (!byEmail.allowed) return tooMany(byEmail, 'api/invitations/accept', RULES.acceptEmail.bucket);
    }

    const user = await findOrLinkUser(identity);
    let tenantId: string;
    try {
      tenantId = await acceptInvitation(user.id, await hashInviteToken(parsed.value.token));
    } catch (e) {
      const failure = acceptFailure(e instanceof Error ? e.message : '');
      if (failure) return refuse(failure);
      throw e;
    }

    // Administrador entra com segundo fator. O convite já foi aceito; sem o segundo fator a pessoa
    // ativa o app autenticador e entra pelo login normal, que fecha a sessão.
    const memberships = await membershipsOf(user.id);
    const late: LoginRefusal | null = membershipRefusal(identity, memberships);
    const role = memberships.find((m) => m.tenantId === tenantId)?.role ?? null;
    await track(tenantId, 'invitation_accepted', { role });
    // Aviso para quem administra a conta (melhor esforço, sem o e-mail no texto).
    await notify(tenantDb(tenantId), {
      kind: 'team.member_joined',
      audience: 'admin',
      link: '/settings/team',
      title: `${user.name ?? identity.name ?? 'Uma pessoa'} entrou na equipe${role ? ` como ${ROLE_COPY[role].label}` : ''}`,
    });
    if (late) return NextResponse.json({ ok: true, accepted: true, tenantId, role, code: late.code, error: late.error }, { status: 202 });

    const token = await createUserSessionToken({ userId: user.id, tenantId, sessionVersion: user.sessionVersion });
    await markLogin(user.id, tenantId);
    const res = NextResponse.json({ ok: true, accepted: true, tenantId, role });
    res.cookies.set(SESSION_COOKIE, token, { ...sessionCookie, maxAge: USER_SESSION_TTL_S });
    return res;
  } catch (e) {
    return apiError(e, 'api/invitations/accept');
  }
}
