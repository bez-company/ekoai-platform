import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { parseCommentText } from '@/lib/engage-model';
import { publishEngagement } from '@/lib/engage';
import { ForbiddenError, requirePermission, UnauthorizedError } from '@/lib/session';
import { UserError, userMessage } from '@/lib/errors';
import { logError } from '@/lib/log';
import { badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.edit');
    const parsed = parseCommentText(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const result = await publishEngagement(t, parsed.value.id, parsed.value.text);
    if (result.ok) await track(t.tenantId, 'engagement_published');
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (!(e instanceof UserError)) logError('api/engage/publish', e);
    // o rascunho segue disponível pra copiar e colar à mão
    return NextResponse.json({ error: userMessage(e), offerCopy: true }, { status: e instanceof UserError ? 400 : 500 });
  }
}
