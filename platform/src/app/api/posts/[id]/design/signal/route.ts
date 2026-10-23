// POST /api/posts/[id]/design/signal: o que só a tela sabe do ajuste rápido (SPEC 019, BEZ-269): a pessoa
// saiu sem confirmar ou pediu mais controle (mover, redimensionar). Vira evento de produto sem texto do post;
// é o dado que libera, ou não, a fase 3. Não grava no banco.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { track } from '@/lib/analytics';
import { parseSignal, signalEvent } from '@/lib/design-edit-events';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    const parsed = parseSignal(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const { event, props } = signalEvent(id, parsed.value);
    await track(t.tenantId, event, props);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/posts/[id]/design/signal');
  }
}
