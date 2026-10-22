// POST /api/suggestions/[id]/replace. Trocar: a sugestão sai e entra outra para o mesmo horário, com outro objetivo.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { replaceSuggestion } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('content.create');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Sugestão não encontrada. Recarregue a página.' }, { status: 404 });
    return NextResponse.json({ suggestion: await replaceSuggestion(t, user, id) });
  } catch (e) {
    return apiError(e, 'api/suggestions/[id]/replace');
  }
}
