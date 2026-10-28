// POST /api/posts/[id]/retry-network: tenta de novo só a rede que falhou num pedido de várias redes (SPEC 028, BEZ-437). O pedido já
// está pronto: só o texto da rede é escrito, do núcleo guardado e da arte que já existe, sem chamar o redator das outras redes e
// sem gastar do limite de posts. Espera o modelo responder (cerca de 10 segundos).

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { retryNetwork } from '@/lib/generation';
import { vertexClient } from '@/lib/vertex';
import { CHANNELS, type Channel } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { channel?: unknown } | null;
    const channel = body?.channel;
    if (typeof channel !== 'string' || !(CHANNELS as readonly string[]).includes(channel)) return badRequest('Diga qual rede tentar de novo.');
    const result = await retryNetwork(t, id, channel as Channel, { model: vertexClient(), critic: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e, 'api/posts/[id]/retry-network');
  }
}
