// /api/media-assets/[id]/file: o arquivo da foto, só com sessão. Nunca por /api/media (pública): a
// foto do banco só vira pública quando entra num post (cópia em images/, ADR 0009).

import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { readMediaAssetBytes } from '@/lib/media-assets';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    const file = isUuid(id) ? await readMediaAssetBytes(t, id) : null;
    if (!file) return new Response('Foto não encontrada', { status: 404 });
    return new Response(Buffer.from(file.bytes), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.bytes.length),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        // O arquivo de um id nunca muda (editar a foto cria outra linha).
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    return apiError(e, 'api/media-assets/[id]/file');
  }
}
