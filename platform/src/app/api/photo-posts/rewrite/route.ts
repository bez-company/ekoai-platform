// POST /api/photo-posts/rewrite: atalho da legenda do post de foto (Encurtar, Mais descontraído, Mais
// formal, Outro CTA; BEZ-254). Uma chamada curta de texto que não conta no limite de posts; entra no
// teto diário da legenda pela foto. Serve ao Publicar foto e à foto que espera em Aprovar.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { parsePhotoRewrite } from '@/lib/photo-post-model';
import { photoRewrite } from '@/lib/photo-post';
import { vertexClient } from '@/lib/vertex';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.create');
    const parsed = parsePhotoRewrite(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    return NextResponse.json(await photoRewrite(t, parsed.value, { model: vertexClient() }));
  } catch (e) {
    return apiError(e, 'api/photo-posts/rewrite');
  }
}
