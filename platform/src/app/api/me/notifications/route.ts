import { NextResponse } from 'next/server';
import { badRequest, apiError } from '@/lib/api';
import { setPref } from '@/lib/notification-prefs';
import { parsePrefChange } from '@/lib/notification-prefs-model';
import { requireUserPermission } from '@/lib/session';

// Seu perfil (BEZ-366): a pessoa liga ou desliga cada categoria de aviso, no app e por e-mail. Vale para todas as contas
// dela; o id vem da sessão, nunca do corpo.
export async function PUT(req: Request) {
  try {
    const { user } = await requireUserPermission('content.view');
    const parsed = parsePrefChange(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    return NextResponse.json({ ok: true, prefs: await setPref(user.id, parsed.value) });
  } catch (e) {
    return apiError(e, 'api/me/notifications');
  }
}
