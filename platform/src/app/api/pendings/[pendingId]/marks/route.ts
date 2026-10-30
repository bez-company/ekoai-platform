// POST /api/pendings/[pendingId]/marks: liga ou desliga a logo e o @ da marca no post do estúdio (BEZ-502). Não gera nada e não gasta do limite: só aponta
// o post para a variante já renderizada. Vale até a pessoa aprovar ou recusar.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { chooseStudioMarks } from '@/lib/studio/marks';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ pendingId: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { pendingId } = await params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(pendingId)) return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { logo?: unknown; handle?: unknown } | null;
    if (!body || typeof body.logo !== 'boolean' || typeof body.handle !== 'boolean') return badRequest('Diga se a logo e o @ ficam ou saem.');
    return NextResponse.json({ ok: true, ...(await chooseStudioMarks(t, pendingId, { logo: body.logo, handle: body.handle })) });
  } catch (e) {
    return apiError(e, 'api/pendings/[pendingId]/marks');
  }
}
