import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { requirePermission, requireSession } from '@/lib/session';
import { parseOnboardingAnswers } from '@/lib/onboarding';
import { saveOnboardingAnswers } from '@/lib/onboarding-data';
import { apiError, badRequest } from '@/lib/api';

// As 3 perguntas rápidas do onboarding (SPEC 017, decisão 11). Pular manda tudo em branco. A última
// cria os horários padrão, então só quem cuida da publicação responde.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('publishing.manage');
    const parsed = parseOnboardingAnswers(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const { user } = await requireSession();
    const { slotsCreated } = await saveOnboardingAnswers(t, user, parsed.value);
    const a = parsed.value;
    await track(t.tenantId, 'onboarding_answered', { source: a.source, goal: a.goal, posts_per_week: a.postsPerWeek, skipped: !a.source && !a.goal && !a.postsPerWeek, slots_created: slotsCreated });
    return NextResponse.json({ ok: true, slotsCreated });
  } catch (e) {
    return apiError(e, 'api/onboarding/answers');
  }
}
