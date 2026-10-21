import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { requirePermission } from '@/lib/session';
import { setOnboardingSkip } from '@/lib/accounts';
import { isSkippable } from '@/lib/onboarding';
import { apiError, badRequest } from '@/lib/api';

// Pular (ou voltar a mostrar) um passo opcional do checklist de Início. Só quem cuida da equipe.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('team.manage');
    const body = (await req.json().catch(() => null)) as { item?: unknown; skipped?: unknown } | null;
    if (!body || !isSkippable(body.item) || typeof body.skipped !== 'boolean') return badRequest('Passo inválido. Recarregue a página.');
    await setOnboardingSkip(t.tenantId, body.item, body.skipped);
    await track(t.tenantId, 'onboarding_item_updated', { item: String(body.item), skipped: body.skipped });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/onboarding');
  }
}
