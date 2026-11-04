// /api/business-events: registrar um resultado comercial com origem (SPEC 038, BEZ-551). Quem cria post registra.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { parseBusinessEvent } from '@/lib/business-event-model';
import { recordEvent } from '@/lib/business-events';
import { todayLocal } from '@/lib/company-facts-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const parsed = parseBusinessEvent(await req.json().catch(() => null), todayLocal());
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    return NextResponse.json({ ok: true, event: await recordEvent(t, user, parsed.value) });
  } catch (e) {
    return apiError(e, 'api/business-events');
  }
}
