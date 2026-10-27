// POST /api/account/plan/agency: pedido de contato do plano Agência (SPEC 025, BEZ-376). Não cobra nada; fica na auditoria da conta.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { requestAgency } from '@/lib/account-plan';
import { parseAgencyRequest } from '@/lib/account-plan-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('billing.manage');
    const parsed = parseAgencyRequest(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    await requestAgency(t, user, parsed.value);
    await track(t.tenantId, 'plan_agency_requested', { brands: parsed.value.brands });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/account/plan/agency');
  }
}
