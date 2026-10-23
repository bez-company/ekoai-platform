// POST /api/posts: pede um post (SPEC 012 R1). Grava o pedido na fila, acorda o worker e responde na
// hora com o id; a tela acompanha em GET /api/posts/[id]. Quem cria conteúdo pode pedir.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { track } from '@/lib/analytics';
import { createPostRequest, parsePostRequest, wakeWorker } from '@/lib/post-requests';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.create');
    const { user } = await requireSession();
    const parsed = parsePostRequest(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    const { id } = await createPostRequest(t, user, parsed.value);
    wakeWorker();
    await track(t.tenantId, 'post_requested', { source: 'manual', brief_id: id, goal: parsed.value.goal, kind: parsed.value.kind, ratio: parsed.value.ratio, with_photo: Boolean(parsed.value.photo) });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return apiError(e, 'api/posts');
  }
}
