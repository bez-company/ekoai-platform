import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { rejectIdea } from '@/lib/ideas';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const body = await req.json().catch(() => null);
    const briefId = typeof body?.briefId === 'string' ? body.briefId : '';
    if (!briefId) return badRequest('Ideia não encontrada.');
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : undefined;
    await rejectIdea(t, briefId, reason);
    await track(t.tenantId, 'idea_rejected', { with_reason: Boolean(reason) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/ideas/reject');
  }
}
