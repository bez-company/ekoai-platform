// /api/facts/[id]: ligar, desligar, editar ou apagar um fato.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { parseFactPatch } from '@/lib/company-facts-model';
import { deleteFact, updateFact } from '@/lib/company-facts';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    const parsed = parseFactPatch({ ...((await req.json().catch(() => null)) as object | null), id });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    await updateFact(t, user, parsed.value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/facts/[id]');
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Fato não encontrado.' }, { status: 404 });
    await deleteFact(t, user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/facts/[id]');
  }
}
