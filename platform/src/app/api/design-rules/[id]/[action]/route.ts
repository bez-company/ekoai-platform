// POST /api/design-rules/[id]/accept | dismiss | disable | enable | undo (SPEC 019, BEZ-270). Só quem gere a
// marca decide. Aceitar leva a regra a ativa (e desliga a que estava ativa no mesmo campo); desligar e ligar
// de novo vão e voltam; desfazer vale logo depois de aceitar e devolve a regra a proposta.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { activateRule, disableRule, dismissRule, undoRule } from '@/lib/design-rules';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['accept', 'dismiss', 'disable', 'enable', 'undo']);

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const t = await requirePermission('brand.manage');
    const { id, action } = await params;
    if (!isUuid(id) || !ACTIONS.has(action)) return NextResponse.json({ error: 'Regra não encontrada. Recarregue a página.' }, { status: 404 });
    const userId = (await requireSession()).user?.id ?? null;
    if (action === 'accept' || action === 'enable') {
      const { rule, turnedOff } = await activateRule(t, id, userId, action === 'accept' ? 'proposed' : 'off');
      return NextResponse.json({ rule, turnedOff });
    }
    const rule = action === 'dismiss' ? await dismissRule(t, id, userId) : action === 'disable' ? await disableRule(t, id, userId) : await undoRule(t, id);
    return NextResponse.json({ rule, turnedOff: [] });
  } catch (e) {
    return apiError(e, 'api/design-rules/[id]/[action]');
  }
}
