// POST /api/suggestions/plan: "Tentar de novo" do Início quando o planejamento da semana não saiu (SPEC 018). Monta
// as sugestões dos horários ainda livres. Gasta do mesmo teto de chamadas ao modelo do dia: passando dele, as ideias
// saem do próprio objetivo (modo simples), mas as sugestões saem.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { planForTenant } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { t } = await requireUserPermission('content.create');
    const saved = await planForTenant(t);
    return NextResponse.json({ ok: true, suggested: saved.length });
  } catch (e) {
    return apiError(e, 'api/suggestions/plan');
  }
}
