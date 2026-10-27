// POST /api/account/plan: upgrade de Individual para Time (SPEC 025, BEZ-376). Só quem administra o plano (billing.manage).

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { track } from '@/lib/analytics';
import { upgradeToTime } from '@/lib/account-plan';
import { parsePlanChange } from '@/lib/account-plan-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('billing.manage');
    const parsed = parsePlanChange(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await upgradeToTime(t, user);
    await track(t.tenantId, 'plan_upgraded', { to: parsed.value.to });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/account/plan');
  }
}
