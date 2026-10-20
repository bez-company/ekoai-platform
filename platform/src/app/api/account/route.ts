import { NextResponse } from 'next/server';
import { SESSION_COOKIE, USER_SESSION_TTL_S, authProvider, createUserSessionToken, sessionCookie } from '@/lib/auth';
import { InvalidIdentityError, verifyIdToken } from '@/lib/identity';
import { accountRefusal, adminAccountLimitRefusal, parseCreateAccount, signupMode } from '@/lib/account-model';
import type { LoginRefusal } from '@/lib/login-policy';
import { createAccount, findOrLinkUser, markLogin, membershipsOf } from '@/lib/accounts';
import { apiError, badRequest, invalidTokenResponse } from '@/lib/api';

export const runtime = 'nodejs';

function refuse(r: LoginRefusal): NextResponse {
  return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
}

// Criar conta (SPEC 011 R2). Rota pública: quem chama ainda não tem conta, então não há sessão; a
// prova é o ID token do Identity Platform. Só existe com SIGNUP_MODE=open e login por pessoa;
// fora disso responde 404, como se não existisse.
export async function POST(req: Request) {
  try {
    if (authProvider() !== 'identity' || signupMode() !== 'open') {
      return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
    }
    const parsed = parseCreateAccount(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);

    let identity;
    try {
      identity = await verifyIdToken(parsed.value.idToken);
    } catch (e) {
      if (e instanceof InvalidIdentityError) return invalidTokenResponse('api/account', e);
      throw e;
    }
    const early = accountRefusal(identity, Math.floor(Date.now() / 1000));
    if (early) return refuse(early);

    const user = await findOrLinkUser(identity);
    const memberships = await membershipsOf(user.id);
    const limit = adminAccountLimitRefusal(memberships.filter((m) => m.role === 'admin').length);
    if (limit) return refuse(limit);

    const tenantId = await createAccount({ userId: user.id, name: parsed.value.name, kind: parsed.value.kind });
    const token = await createUserSessionToken({ userId: user.id, tenantId, sessionVersion: user.sessionVersion });
    await markLogin(user.id, tenantId);
    const res = NextResponse.json({ ok: true, tenantId, role: 'admin' }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, { ...sessionCookie, maxAge: USER_SESSION_TTL_S });
    return res;
  } catch (e) {
    return apiError(e, 'api/account');
  }
}
