import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { parseApproveIdea } from '@/lib/ideas-model';
import { approveIdea } from '@/lib/ideas';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseApproveIdea(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const result = await approveIdea(t, parsed.value.briefId, parsed.value.items);
    await track(t.tenantId, 'idea_approved');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e, 'api/ideas/approve');
  }
}
