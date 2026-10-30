// POST /api/posts/[id]/retry-level: o pedido caiu do Refinado ou do Autoral para o Rápido; cria o mesmo pedido de novo, no nível que a pessoa
// tinha escolhido (BEZ-497). Responde com o id do pedido novo; a tela acompanha em Aprovar.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { retryAtRequestedLevel, wakeWorker } from '@/lib/post-requests';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.create');
    const { user } = await requireSession();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    const created = await retryAtRequestedLevel(t, user, id);
    wakeWorker();
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) {
    return apiError(e, 'api/posts/[id]/retry-level');
  }
}
