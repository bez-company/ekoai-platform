// POST /api/suggestions/[id]/replace. Trocar: a sugestão sai e entra outra para o mesmo horário, com outro objetivo.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { isUuid } from '@/lib/route-input';
import { replaceSuggestion } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Sugestão não encontrada. Recarregue a página.' }, { status: 404 });
    const suggestion = await replaceSuggestion(t, user, id);
    await track(t.tenantId, 'suggestion_replaced', { had_next: Boolean(suggestion) });
    return NextResponse.json({ suggestion });
  } catch (e) {
    return apiError(e, 'api/suggestions/[id]/replace');
  }
}
