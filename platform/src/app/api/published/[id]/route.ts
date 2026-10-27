// DELETE /api/published/[id]: tira um post publicado da lista de Publicados (BEZ-360). Não apaga no Instagram: a API
// da Meta não deixa; a pessoa apaga lá. Quem aprova posts pode tirar.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { removePublished } from '@/lib/published-feed';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.approve');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 });
    if (!(await removePublished(t, id))) return NextResponse.json({ error: 'Post não encontrado. Ele pode já ter saído da lista.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/published/[id]');
  }
}
