import { NextResponse } from 'next/server';
import { reschedulePost, cancelScheduled, retryScheduled } from '@/lib/scheduling';
import { publishNow } from '@/lib/publish';
import { requirePermission } from '@/lib/session';
import { parseScheduledAction } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

// Publicar agora espera a rede aceitar o post.
export const maxDuration = 60;

// Ações sobre um agendado: reschedule | cancel | retry | publish_now.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseScheduledAction(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const a = parsed.value;
    if (a.action === 'publish_now') {
      const published = await publishNow(t, a.id);
      if (!published.ok) return NextResponse.json({ error: `Não deu para publicar: ${published.error}` }, { status: 502 });
      return NextResponse.json({ ok: true });
    }
    if (a.action === 'reschedule') await reschedulePost(t, a.id, a.scheduledFor);
    else if (a.action === 'cancel') await cancelScheduled(t, a.id);
    else await retryScheduled(t, a.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/scheduled');
  }
}
