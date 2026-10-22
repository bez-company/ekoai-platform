// POST /api/photo-posts/caption: a Ekoai olha a foto e escreve a legenda (SPEC 017 decisão 10). Uma
// chamada curta de texto com visão, síncrona; não conta no limite do plano. A pessoa edita antes.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { parsePhotoCaptionRequest } from '@/lib/photo-post-model';
import { photoCaption } from '@/lib/photo-post';
import { vertexClient } from '@/lib/vertex';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.create');
    const parsed = parsePhotoCaptionRequest(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    return NextResponse.json(await photoCaption(t, parsed.value, { model: vertexClient() }));
  } catch (e) {
    return apiError(e, 'api/photo-posts/caption');
  }
}
