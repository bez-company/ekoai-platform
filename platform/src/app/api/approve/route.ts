import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { approvePending } from '@/lib/scheduling';
import { requirePermission } from '@/lib/session';
import { parseApprove } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseApprove(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const result = await approvePending(t, parsed.value);
    await track(t.tenantId, 'post_approved');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e, 'api/approve');
  }
}
