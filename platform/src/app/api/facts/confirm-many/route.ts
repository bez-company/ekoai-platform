// /api/facts/confirm-many: confirma os fatos que a pessoa marcou (1 a 50). Não há "confirmar todos": a
// pessoa lê e marca cada um, porque o agente pode ter lido errado (ADR 0019).

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { parseConfirmMany } from '@/lib/company-facts-model';
import { confirmFacts } from '@/lib/company-facts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const parsed = parseConfirmMany(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    return NextResponse.json({ ok: true, confirmed: await confirmFacts(t, user, parsed.value) });
  } catch (e) {
    return apiError(e, 'api/facts/confirm-many');
  }
}
