// POST /api/suggestions/[id]/create. Criar este post: sem foto vira pedido de post (201 com briefId); com foto do banco, a tela abre o Publicar foto (200 com assetId e a ideia).

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { isUuid } from '@/lib/route-input';
import { createFromSuggestion } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Sugestão não encontrada. Recarregue a página.' }, { status: 404 });
    const out = await createFromSuggestion(t, user, id);
    await track(t.tenantId, 'suggestion_accepted', { via: out.kind });
    if (out.kind === 'generate') await track(t.tenantId, 'post_requested', { source: 'suggestion', brief_id: out.briefId });
    return NextResponse.json(out, { status: out.kind === 'generate' ? 201 : 200 });
  } catch (e) {
    return apiError(e, 'api/suggestions/[id]/create');
  }
}
