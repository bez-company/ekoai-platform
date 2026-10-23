// /api/facts/[id]/confirm: uma pessoa confirma um fato pendente (SPEC 018, ADR 0019). O prazo é opcional.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { parseConfirm } from '@/lib/company-facts-model';
import { confirmFact } from '@/lib/company-facts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Fato não encontrado.' }, { status: 404 });
    const parsed = parseConfirm(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    await confirmFact(t, user, id, parsed.value.validUntil);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/facts/[id]/confirm');
  }
}
