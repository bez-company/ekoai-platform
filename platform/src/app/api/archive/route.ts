import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { requirePermission } from '@/lib/session';
import { parseArchive } from '@/lib/route-input';
import { setPendingArchived } from '@/lib/stale-approvals';
import { apiError, badRequest } from '@/lib/api';

// Arquivar um post de Aprovar, ou desfazer (SPEC 017, decisão 12). Não é rejeição: não vira sinal de
// aprendizado. Quem aprova decide.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseArchive(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await setPendingArchived(t, parsed.value.pendingId, parsed.value.archived);
    await track(t.tenantId, 'post_archived', { archived: parsed.value.archived });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/archive');
  }
}
