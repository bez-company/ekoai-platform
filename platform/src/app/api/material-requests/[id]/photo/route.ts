// /api/material-requests/[id]/photo: responde um pedido de foto com até 4 fotos do banco de imagens (SPEC 036). A foto nova
// sobe antes por /api/media-assets; aqui ganha a etiqueta pedida, e a primeira que pode entrar em post vai para a sugestão.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { answerPhoto } from '@/lib/material-requests';
import { isRequestId, parseAnswerPhoto } from '@/lib/material-request-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isRequestId(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    const parsed = parseAnswerPhoto(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    return NextResponse.json({ ok: true, ...(await answerPhoto(t, user, id, parsed.value.assetIds)) });
  } catch (e) {
    return apiError(e, 'api/material-requests/[id]/photo');
  }
}
