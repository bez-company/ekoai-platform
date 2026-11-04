// /api/material-requests/[id]/confirm: responde um pedido de confirmação (SPEC 036): o fato continua (com prazo), mudou
// (texto novo, já confirmado) ou não vale mais (desligado). Mesma permissão da tela de fatos.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { answerConfirm } from '@/lib/material-requests';
import { isRequestId, parseAnswerConfirm } from '@/lib/material-request-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isRequestId(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    const parsed = parseAnswerConfirm(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    return NextResponse.json({ ok: true, ...(await answerConfirm(t, user, id, parsed.value)) });
  } catch (e) {
    return apiError(e, 'api/material-requests/[id]/confirm');
  }
}
