// /api/rules/[id]/versions: o histórico de uma regra (SPEC 037), da versão mais nova para a mais antiga. Quem vê o conteúdo lê.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { listRuleVersions } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
    return NextResponse.json({ versions: await listRuleVersions(t, id) });
  } catch (e) {
    return apiError(e, 'api/rules/[id]/versions');
  }
}
