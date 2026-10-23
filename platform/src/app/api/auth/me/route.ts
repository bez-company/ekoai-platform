import { NextResponse } from 'next/server';
import { membershipsOf } from '@/lib/accounts';
import { activeMemberships } from '@/lib/login-policy';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError } from '@/lib/api';

// Quem está logado, a conta ativa, o papel nela e as outras contas (para o seletor do topo).
export async function GET() {
  try {
    await requirePermission('content.view');
    const { t, role, user } = await requireSession();
    const memberships = user ? activeMemberships(await membershipsOf(user.id)) : [];
    return NextResponse.json({
      tenantId: t.tenantId,
      role,
      userId: user?.id ?? null,
      accounts: memberships.map((m) => ({ tenantId: m.tenantId, role: m.role })),
    });
  } catch (e) {
    return apiError(e, 'api/auth/me');
  }
}
