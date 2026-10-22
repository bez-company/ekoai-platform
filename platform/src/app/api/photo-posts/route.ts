// POST /api/photo-posts: foto do banco de imagens vira post sem gerar imagem (SPEC 017 decisão 10,
// BEZ-236). Corta no formato, e então agenda, publica agora ou, para quem não aprova, manda para
// Aprovar. Foto com pessoas sem autorização de uso de imagem é recusada (400).

import { NextResponse } from 'next/server';
import { can, requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { track } from '@/lib/analytics';
import { parsePhotoPost } from '@/lib/photo-post-model';
import { createPhotoPost } from '@/lib/photo-post';

export const dynamic = 'force-dynamic';
// Publicar agora espera o Instagram processar a imagem.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.create');
    const parsed = parsePhotoPost(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const result = await createPhotoPost(t, null, { ...parsed.value, canApprove: await can('content.approve') });
    await track(t.tenantId, 'photo_post_created', { ratio: parsed.value.ratio, when: parsed.value.when, status: result.status });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    return apiError(e, 'api/photo-posts');
  }
}
