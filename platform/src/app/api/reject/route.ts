import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { rejectPending } from '@/lib/scheduling';
import { parseFeedbackInput } from '@/lib/learning';
import { saveFeedback } from '@/lib/feedback';
import { requirePermission } from '@/lib/session';
import { parseReject } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

// Rejeitar pede o feedback junto (SPEC 003 R3.4/R4.2): a nota vira o motivo do anti-exemplo
// e o feedback estruturado entra no prompt das próximas gerações.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseReject(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const { pendingId, reason, feedback } = parsed.value;

    let parsedFeedback = null;
    if (feedback) {
      const fb = parseFeedbackInput({ ...(feedback as object), pending_id: pendingId });
      if (!fb.ok) return badRequest(fb.error);
      parsedFeedback = fb.value;
    }

    const why = parsedFeedback ? `${parsedFeedback.aspect}: ${parsedFeedback.note}` : reason;
    await rejectPending(t, pendingId, why);
    if (parsedFeedback) await saveFeedback(t, parsedFeedback);
    await track(t.tenantId, 'post_rejected', { with_feedback: Boolean(parsedFeedback) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/reject');
  }
}
