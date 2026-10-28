import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { parseApproveAll } from '@/lib/ideas-model';
import { approveAll } from '@/lib/ideas';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseApproveAll(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const result = await approveAll(t, parsed.value.briefId, parsed.value.items);
    await track(t.tenantId, 'post_approved', { networks: result.scheduled.length, skipped: result.skipped });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e, 'api/ideas/approve-all');
  }
}
