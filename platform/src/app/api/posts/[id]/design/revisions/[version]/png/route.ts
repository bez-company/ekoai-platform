// GET /api/posts/[id]/design/revisions/[version]/png: a imagem de uma versão, desenhada na hora (a
// revisão guarda parâmetros, não pixels). Privado: quem vê o conteúdo da conta lê.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { parseVersion } from '@/lib/design/edit-model';
import { revisionPng } from '@/lib/post-design-revisions';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id, version } = await params;
    const v = parseVersion(version);
    if (!isUuid(id) || !v.ok) return NextResponse.json({ error: 'Versão não encontrada. Recarregue a lista de versões.' }, { status: 404 });
    const png = await revisionPng(t, id, v.value);
    return new NextResponse(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60' } });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/revisions/[version]/png');
  }
}
