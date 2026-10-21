import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { SESSION_COOKIE, USER_SESSION_TTL_S, authProvider, createUserSessionToken, sessionCookie } from '@/lib/auth';
import { InvalidIdentityError, verifyIdToken } from '@/lib/identity';
import { identityRefusal, isRefusal, membershipRefusal, pickTenant, type LoginRefusal } from '@/lib/login-policy';
import { findOrLinkUser, markLogin, membershipsOf } from '@/lib/accounts';
import { parseSessionBody } from '@/lib/route-input';
import { apiError, badRequest, invalidTokenResponse } from '@/lib/api';

export const runtime = 'nodejs';

function refuse(r: LoginRefusal): NextResponse {
  return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
}

// Login por pessoa (SPEC 009): o ID token do Identity Platform vira a nossa sessão.
export async function POST(req: Request) {
  try {
    if (authProvider() !== 'identity') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
    const parsed = parseSessionBody(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);

    let identity;
    try {
      identity = await verifyIdToken(parsed.value.idToken);
    } catch (e) {
      if (e instanceof InvalidIdentityError) return invalidTokenResponse('api/auth/session', e);
      throw e;
    }
    const early = identityRefusal(identity, Math.floor(Date.now() / 1000));
    if (early) return refuse(early);

    const user = await findOrLinkUser(identity);
    const memberships = await membershipsOf(user.id);
    const late = membershipRefusal(identity, memberships);
    if (late) return refuse(late);
    const picked = pickTenant(memberships, parsed.value.tenantId, user.lastTenantId);
    if (isRefusal(picked)) return refuse(picked);

    const token = await createUserSessionToken({ userId: user.id, tenantId: picked.tenantId, sessionVersion: user.sessionVersion });
    await markLogin(user.id, picked.tenantId);
    await track(picked.tenantId, 'signed_in', { role: picked.role });
    const res = NextResponse.json({ ok: true, tenantId: picked.tenantId, role: picked.role });
    res.cookies.set(SESSION_COOKIE, token, { ...sessionCookie, maxAge: USER_SESSION_TTL_S });
    return res;
  } catch (e) {
    return apiError(e, 'api/auth/session');
  }
}
