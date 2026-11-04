// /api/business-events/[id]: apagar um resultado registrado errado (SPEC 038). Quem registrou ou quem gerencia a marca.

import { NextResponse } from 'next/server';
import { can, requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { deleteEvent } from '@/lib/business-events';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Resultado não encontrado.' }, { status: 404 });
    await deleteEvent(t, user, id, await can('brand.manage'));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/business-events/[id]');
  }
}
