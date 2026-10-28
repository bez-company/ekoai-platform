// GET /api/posts/[id]/design/export?format=png|svg&slide=: baixar o post da versão em uso (SPEC 027). PNG exatamente como vai para o
// Instagram; SVG com cada texto e a logo como elementos próprios. Quem vê o conteúdo baixa.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { exportDesign } from '@/lib/post-design-revisions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    const q = new URL(req.url).searchParams;
    const format = q.get('format');
    if (format !== 'png' && format !== 'svg') return NextResponse.json({ error: 'Escolha png ou svg.' }, { status: 400 });
    const rawSlide = q.get('slide');
    const out = await exportDesign(t, id, { format, slide: rawSlide !== null && /^\d{1,2}$/.test(rawSlide) ? Number(rawSlide) : undefined });
    return new NextResponse(typeof out.body === 'string' ? out.body : new Uint8Array(out.body), {
      headers: { 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/export');
  }
}
