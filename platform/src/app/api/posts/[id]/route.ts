// GET /api/posts/[id]: o andamento de um pedido (fila, gerando, pronto com a pendência, ou falha).

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { postProgress } from '@/lib/post-requests';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    const progress = await postProgress(t, id);
    if (!progress) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    return NextResponse.json(progress);
  } catch (e) {
    return apiError(e, 'api/posts/[id]');
  }
}
