// /api/facts: os fatos da empresa e o que ela nunca afirma (SPEC 012, decisão 5). Quem vê o perfil lê;
// quem gere a marca escreve.

import { NextResponse } from 'next/server';
import { requirePermission, requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { parseFactInput } from '@/lib/company-facts-model';
import { createFact, listFacts } from '@/lib/company-facts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('profile.view');
    return NextResponse.json({ facts: await listFacts(t) });
  } catch (e) {
    return apiError(e, 'api/facts');
  }
}

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const parsed = parseFactInput(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    const fact = await createFact(t, user, parsed.value);
    return NextResponse.json({ fact }, { status: 201 });
  } catch (e) {
    return apiError(e, 'api/facts');
  }
}
