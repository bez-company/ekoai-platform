// POST /api/agency/clients: a agência cadastra um cliente (SPEC 039, BEZ-265). Cria a conta do cliente, com a agência como
// dona, e já troca a sessão para ela: o próximo passo é conectar o Instagram do cliente em Configurações › Redes.

import { NextResponse } from 'next/server';
import { SESSION_COOKIE, USER_SESSION_TTL_S, createUserSessionToken, sessionCookie } from '@/lib/auth';
import { markLogin } from '@/lib/accounts';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { agencyContext, createClient } from '@/lib/agency';
import { parseNewClient } from '@/lib/agency-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('billing.manage');
    const parsed = parseNewClient(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    const ctx = await agencyContext(t.tenantId);
    if (!ctx.isAgency) return NextResponse.json({ error: 'Esta conta não é uma agência. Peça o plano Agência em Perfil, Conta e plano.' }, { status: 403 });

    const id = await createClient(t.tenantId, user, parsed.value.name);
    await track(t.tenantId, 'agency_client_created', {});
    const token = await createUserSessionToken({ userId: user.id, tenantId: id, sessionVersion: user.sessionVersion });
    await markLogin(user.id, id);
    const res = NextResponse.json({ ok: true, tenantId: id }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, { ...sessionCookie, maxAge: USER_SESSION_TTL_S });
    return res;
  } catch (e) {
    return apiError(e, 'api/agency/clients');
  }
}
