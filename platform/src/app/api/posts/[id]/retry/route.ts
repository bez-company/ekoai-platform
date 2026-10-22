// POST /api/posts/[id]/retry: pedido que falhou volta para a fila. As chamadas que deram certo são
// reaproveitadas pela chave de idempotência; só o que faltou é gerado.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { retryPostRequest, wakeWorker } from '@/lib/post-requests';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    await retryPostRequest(t, id);
    wakeWorker();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/posts/[id]/retry');
  }
}
