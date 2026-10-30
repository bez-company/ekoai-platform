// POST /api/pendings/[pendingId]/option: escolhe uma das opções de design do estúdio (SPEC 030, F4). Não gera nada e não gasta do limite: só aponta o
// post para outra das peças já criadas. Vale até a pessoa aprovar ou recusar.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { chooseStudioOption } from '@/lib/studio/options';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ pendingId: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { pendingId } = await params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(pendingId)) return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { index?: unknown } | null;
    if (!body || typeof body.index !== 'number' || !Number.isInteger(body.index)) return badRequest('Escolha uma das opções da lista.');
    return NextResponse.json({ ok: true, ...(await chooseStudioOption(t, pendingId, body.index)) });
  } catch (e) {
    return apiError(e, 'api/pendings/[pendingId]/option');
  }
}
