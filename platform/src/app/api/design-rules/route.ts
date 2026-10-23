// GET /api/design-rules: as regras do design da conta (propostas, ativas, desligadas e dispensadas), com o
// nome e a explicação de cada uma (SPEC 019). Quem vê o perfil lê.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { listRules } from '@/lib/design-rules';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('profile.view');
    return NextResponse.json({ rules: await listRules(t) });
  } catch (e) {
    return apiError(e, 'api/design-rules');
  }
}
