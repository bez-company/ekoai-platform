// POST /api/posts/[id]/design/revisions/[version]/restore: voltar a uma versão antiga. Cria uma versão
// nova com o design dela (nenhuma é apagada). 409 se a versão em uso mudou desde que a pessoa abriu.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { parseRestoreBody, parseVersion } from '@/lib/design/edit-model';
import { restoreVersion } from '@/lib/post-design-revisions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id, version } = await params;
    const v = parseVersion(version);
    if (!isUuid(id) || !v.ok) return NextResponse.json({ error: 'Versão não encontrada. Recarregue a lista de versões.' }, { status: 404 });
    const parsed = parseRestoreBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const userId = (await requireSession()).user?.id ?? null;
    const saved = await restoreVersion(t, id, { version: v.value, baseVersion: parsed.value.baseVersion, userId });
    return NextResponse.json(saved, { status: 201 });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/revisions/[version]/restore');
  }
}
