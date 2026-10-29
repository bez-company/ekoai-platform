// POST /api/pendings/[pendingId]/signal: reavalia o texto de uma rede ou aplica uma sugestão do avaliador (SPEC 028, BEZ-441). Trabalha
// sobre o texto que a pessoa está vendo (editado ou não), chama só o avaliador e o conserto curto, não gasta do limite de posts e não
// muda o post guardado: o texto novo volta para a tela, que o aprova ou desfaz.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { reviewSignal } from '@/lib/generation';
import { parseSignalRequest } from '@/lib/signal-text';
import { vertexClient } from '@/lib/vertex';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ pendingId: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { pendingId } = await params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(pendingId)) return NextResponse.json({ error: 'Post não encontrado.' }, { status: 404 });
    const parsed = parseSignalRequest(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const out = await reviewSignal(t, { model: vertexClient() }, { pendingId, ...parsed.value });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return apiError(e, 'api/pendings/[pendingId]/signal');
  }
}
