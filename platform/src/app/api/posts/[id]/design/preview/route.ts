// POST /api/posts/[id]/design/preview: desenha o design editado e roda o revisor, sem gravar nada
// (SPEC 019). Não chama o modelo. Devolve a imagem reduzida e os achados.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { badRequest } from '@/lib/api';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { parseEditBody } from '@/lib/design/edit-model';
import { previewEdit } from '@/lib/post-design-revisions';
import { hit, tooMany } from '@/lib/rate-limit';
import { RULES } from '@/lib/rate-limit-model';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    const parsed = parseEditBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const limited = await hit(RULES.designPreview, t.tenantId);
    if (!limited.allowed) return tooMany(limited, 'api/posts/design/preview', RULES.designPreview.bucket);
    const out = await previewEdit(t, id, { baseVersion: parsed.value.baseVersion, edit: parsed.value.edit });
    return NextResponse.json(out);
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/preview');
  }
}
