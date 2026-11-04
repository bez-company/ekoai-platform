// /api/material-requests/[id]/dismiss: "Não tenho agora" (SPEC 036). O post sai sem o material e a Ekoai não pede a mesma
// coisa por 14 dias.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { dismissRequest } from '@/lib/material-requests';
import { isRequestId } from '@/lib/material-request-model';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isRequestId(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    await dismissRequest(t, user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/material-requests/[id]/dismiss');
  }
}
