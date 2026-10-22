// POST /api/posts/[id]/caption: atalho de ajuste da legenda (Encurtar, Mais descontraído, Mais formal,
// Outro CTA). Chamada curta ao modelo, síncrona; devolve a legenda nova para a pessoa aprovar ou não.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { isRewriteMode } from '@/lib/agents';
import { rewriteCaption } from '@/lib/generation';
import { vertexClient } from '@/lib/vertex';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { mode?: unknown; caption?: unknown; hashtags?: unknown } | null;
    if (!isRewriteMode(body?.mode)) return badRequest('Escolha um atalho de ajuste.');
    const caption = typeof body?.caption === 'string' ? body.caption.trim().slice(0, 2200) : '';
    if (!caption) return badRequest('A legenda está vazia.');
    const hashtags = Array.isArray(body?.hashtags) ? body!.hashtags.map(String).slice(0, 30) : [];
    const out = await rewriteCaption(t, { model: vertexClient() }, { briefId: id, mode: body!.mode, caption, hashtags });
    return NextResponse.json(out);
  } catch (e) {
    return apiError(e, 'api/posts/[id]/caption');
  }
}
