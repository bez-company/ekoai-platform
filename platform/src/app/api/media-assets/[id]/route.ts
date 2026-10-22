// /api/media-assets/[id]: uma foto do banco de imagens. GET lê, PATCH altera descrição, etiquetas e a
// autorização de uso de imagem, DELETE apaga (post já publicado continua com a cópia dele).

import { NextResponse } from 'next/server';
import { requirePermission, requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { parseMediaPatch } from '@/lib/media-asset-model';
import { deleteMediaAsset, getMediaAsset, updateMediaAsset } from '@/lib/media-assets';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Esta foto não está mais no banco de imagens.' }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const asset = await getMediaAsset(t, id);
    return asset ? NextResponse.json({ asset }) : notFound();
  } catch (e) {
    return apiError(e, 'api/media-assets/[id]');
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const parsed = parseMediaPatch(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    return NextResponse.json({ asset: await updateMediaAsset(t, user, id, parsed.value) });
  } catch (e) {
    return apiError(e, 'api/media-assets/[id]');
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    await deleteMediaAsset(t, user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/media-assets/[id]');
  }
}
