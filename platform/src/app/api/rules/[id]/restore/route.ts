// /api/rules/[id]/restore: volta a regra para uma versão do histórico (SPEC 037). Cria uma versão nova; nada se apaga.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { parseRestore } from '@/lib/learning';
import { restoreRuleVersion } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('brand.manage');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
    const parsed = parseRestore(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const { user } = await requireSession();
    await restoreRuleVersion(t, id, parsed.value.version, user?.id ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/rules/[id]/restore');
  }
}
