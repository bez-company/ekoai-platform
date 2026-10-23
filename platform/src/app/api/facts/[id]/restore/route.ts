// /api/facts/[id]/restore: desfaz a recusa. O fato volta a pendente para ser revisado de novo.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { restoreFact } from '@/lib/company-facts';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Fato não encontrado.' }, { status: 404 });
    await restoreFact(t, user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/facts/[id]/restore');
  }
}
