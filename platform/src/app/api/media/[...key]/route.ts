// GET /api/media/<chave>: entrega uma mídia do bucket privado. Pública de propósito (as redes
// buscam por aqui ao publicar); a proteção é a chave com UUID e o formato fixo (lib/media.ts).

import { Readable } from 'node:stream';
import { mediaFile, parseMediaKey, parseRange } from '@/lib/media';
import { localStore } from '@/lib/brand-logo';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const BASE_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Content-Disposition': 'inline',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const parsed = parseMediaKey((await params).key);
  if (!parsed) return new Response('Não encontrado', { status: 404 });

  // Desenvolvimento sem bucket: os PNGs gerados ficam em LOCAL_BLOB_DIR (ignorada em produção).
  if (process.env.LOCAL_BLOB_DIR && process.env.NODE_ENV !== 'production') {
    try {
      const bytes = await localStore(process.env.LOCAL_BLOB_DIR).get(parsed.key);
      return new Response(Buffer.from(bytes), { headers: { ...BASE_HEADERS, 'Content-Type': parsed.contentType, 'Content-Length': String(bytes.length) } });
    } catch {
      return new Response('Não encontrado', { status: 404 });
    }
  }

  try {
    const file = mediaFile(parsed.key);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    const range = parseRange(req.headers.get('range'), size);
    const stream = file.createReadStream(range ? { start: range.start, end: range.end } : undefined);
    const body = Readable.toWeb(stream) as ReadableStream;

    if (!range) {
      return new Response(body, {
        headers: { ...BASE_HEADERS, 'Content-Type': parsed.contentType, 'Content-Length': String(size) },
      });
    }
    return new Response(body, {
      status: 206,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': parsed.contentType,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  } catch (e) {
    if ((e as { code?: number }).code === 404) return new Response('Não encontrado', { status: 404 });
    log('error', 'media', 'falha ao ler mídia', { object: parsed.key, error: e instanceof Error ? e.message : String(e) });
    return new Response('Falha ao ler a mídia', { status: 502 });
  }
}
