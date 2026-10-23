// POST /api/posts/[id]/direction: "outra direção". Avisa na tela que conta no limite do mês.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { isUuid } from '@/lib/route-input';
import { requestAnotherDirection, wakeWorker } from '@/lib/post-requests';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    await requestAnotherDirection(t, id);
    wakeWorker();
    await track(t.tenantId, 'rework', { kind: 'another_direction', brief_id: id });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiError(e, 'api/posts/[id]/direction');
  }
}
