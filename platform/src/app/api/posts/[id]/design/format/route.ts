// POST /api/posts/[id]/design/format: troca o post entre uma imagem e carrossel (SPEC 023, BEZ-313). Grava uma
// versão nova, que a pessoa desfaz trocando de volta. Para carrossel pode haver uma chamada de texto (escrever as
// lâminas); nunca chama o modelo de imagem e não conta no limite do mês.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { parseFormatBody } from '@/lib/design/edit-model';
import { switchFormat } from '@/lib/post-design-revisions';
import { writeCarouselSlides } from '@/lib/generation';
import { vertexClient } from '@/lib/vertex';
import { hit, tooMany } from '@/lib/rate-limit';
import { RULES } from '@/lib/rate-limit-model';
import { track } from '@/lib/analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    const parsed = parseFormatBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const limited = await hit(RULES.designAsk, t.tenantId);
    if (!limited.allowed) return tooMany(limited, 'api/posts/design/format', RULES.designAsk.bucket);
    const userId = (await requireSession()).user?.id ?? null;
    let modelCalls = 0;
    const saved = await switchFormat(t, id, { ...parsed.value, userId }, {
      writeSlides: async () => {
        modelCalls = 1;
        return (await writeCarouselSlides(t, id, { model: vertexClient() })).slides;
      },
    });
    await track(t.tenantId, 'design_format_switched', { brief_id: id, to: parsed.value.to, version: saved.version, model_calls: modelCalls });
    return NextResponse.json(saved, { status: 201 });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/format');
  }
}
