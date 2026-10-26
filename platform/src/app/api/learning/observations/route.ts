// PUT /api/learning/observations (SPEC 022, BEZ-206): quem gere a marca liga ou desliga uma observação do
// público como dica do planejamento de ideias. O corpo é validado antes de qualquer I/O.

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { setObservation } from '@/lib/observations';
import { parseObservationInput } from '@/lib/observations-model';
import { requirePermission, requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  try {
    const t = await requirePermission('brand.manage');
    const parsed = parseObservationInput(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const userId = (await requireSession()).user?.id ?? null;
    await setObservation(t, userId, parsed.value.key, parsed.value.enabled);
    return NextResponse.json({ ok: true, key: parsed.value.key, enabled: parsed.value.enabled });
  } catch (e) {
    return apiError(e, 'api/learning/observations');
  }
}
