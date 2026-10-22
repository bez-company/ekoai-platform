// /api/media-assets/[id]/thumb: a miniatura da foto (JPEG, lado menor de 480 px), só com sessão. A grade
// do banco de imagens e o seletor usam esta; o corte e a publicação continuam com a original.

import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { readThumb } from '@/lib/media-thumbs';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    const thumb = isUuid(id) ? await readThumb(t, id) : null;
    if (!thumb) return new Response('Foto não encontrada', { status: 404 });
    return new Response(Buffer.from(thumb), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(thumb.length),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    return apiError(e, 'api/media-assets/[id]/thumb');
  }
}
