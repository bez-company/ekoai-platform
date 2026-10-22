// /api/media-assets: o banco de imagens da empresa (SPEC 017 decisão 9, BEZ-198). GET lista, com os
// filtros não usadas, usadas e por etiqueta; POST sobe até 10 fotos (multipart, campo `files`). O
// tipo vem dos bytes e os metadados (GPS, EXIF) saem antes de guardar.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { MEDIA_MAX_BYTES, MEDIA_MAX_PER_UPLOAD, cleanFileName, inspectPhoto, parseListQuery } from '@/lib/media-asset-model';
import { listMediaAssets, saveMediaAssets, type UploadedPhoto } from '@/lib/media-assets';

export const dynamic = 'force-dynamic';

// O Cloud Run recusa corpo acima de 32 MB: o lote fica abaixo disso.
const MAX_BODY = 30 * 1024 * 1024;

export async function GET(req: Request) {
  try {
    const t = await requirePermission('content.view');
    const assets = await listMediaAssets(t, parseListQuery(new URL(req.url).searchParams));
    return NextResponse.json({ assets });
  } catch (e) {
    return apiError(e, 'api/media-assets');
  }
}

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.create');
    const { user } = await requireSession();
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return badRequest('O envio passa de 30 MB. Mande menos fotos de cada vez.');
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll('files') ?? []).filter((f): f is File => f instanceof File);
    if (!files.length) return badRequest('Escolha ao menos uma foto JPEG ou PNG.');
    if (files.length > MEDIA_MAX_PER_UPLOAD) return badRequest(`Envie até ${MEDIA_MAX_PER_UPLOAD} fotos de cada vez.`);

    const photos: UploadedPhoto[] = [];
    for (const file of files) {
      const name = cleanFileName(file.name);
      if (file.size > MEDIA_MAX_BYTES) return badRequest(`${name ?? 'Uma das fotos'}: passa de 10 MB. Use foto JPEG ou PNG de até 10 MB.`);
      const photo = inspectPhoto(new Uint8Array(await file.arrayBuffer()));
      if (!photo.ok) return badRequest(`${name ?? 'Uma das fotos'}: ${photo.error}`);
      photos.push({ photo, name });
    }
    const assets = await saveMediaAssets(t, user, photos);
    return NextResponse.json({ assets });
  } catch (e) {
    return apiError(e, 'api/media-assets');
  }
}
