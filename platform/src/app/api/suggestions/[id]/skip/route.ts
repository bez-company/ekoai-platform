// POST /api/suggestions/[id]/skip. Pular: o horário fica sem sugestão nesta semana.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { isUuid } from '@/lib/route-input';
import { skipSuggestion } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Sugestão não encontrada. Recarregue a página.' }, { status: 404 });
    await skipSuggestion(t, user, id);
    await track(t.tenantId, 'suggestion_skipped');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/suggestions/[id]/skip');
  }
}
