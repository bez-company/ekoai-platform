// /api/material-requests: os pedidos de material abertos da conta (SPEC 036, BEZ-549), para o Início. Quem cria post vê;
// quem só acompanha não recebe pedido.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { listOpenRequests } from '@/lib/material-requests';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('content.create');
    return NextResponse.json({ requests: await listOpenRequests(t) });
  } catch (e) {
    return apiError(e, 'api/material-requests');
  }
}
