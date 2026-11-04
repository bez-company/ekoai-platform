// /api/rules: criar e mudar as regras de texto e tom (SPEC 003; escopo e versão na SPEC 037). Toda mudança guarda uma versão.

import { NextResponse } from 'next/server';
import { parseRuleInput, parseRulePatch } from '@/lib/learning';
import { createRule, updateRule } from '@/lib/feedback';
import { requirePermission, requireSession } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('brand.manage');
    const parsed = parseRuleInput(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const { user } = await requireSession();
    const id = await createRule(t, parsed.value, user?.id ?? null);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiError(e, 'api/rules');
  }
}

export async function PATCH(req: Request) {
  try {
    const t = await requirePermission('brand.manage');
    const parsed = parseRulePatch(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const { user } = await requireSession();
    await updateRule(t, parsed.value.id, parsed.value, user?.id ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/rules');
  }
}
