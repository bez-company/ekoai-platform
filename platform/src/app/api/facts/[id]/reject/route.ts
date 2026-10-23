// /api/facts/[id]/reject: uma pessoa recusa um fato pendente. Ele fica guardado e nunca entra num post.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { rejectFact } from '@/lib/company-facts';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Fato não encontrado.' }, { status: 404 });
    await rejectFact(t, user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/facts/[id]/reject');
  }
}
