import { NextResponse } from 'next/server';
import { setPause } from '@/lib/pause';
import { notify } from '@/lib/notifications';
import { requirePermission } from '@/lib/session';
import { parsePause } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('publishing.manage');
    const parsed = parsePause(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    const state = await setPause(t, parsed.value.paused, parsed.value.reason);
    await notify(t, state.paused
      ? {
          kind: 'publishing.paused',
          level: 'warning',
          title: 'Publicação pausada: nada sai até retomar',
          body: state.reason || undefined,
          link: '/configuracoes',
        }
      : {
          kind: 'publishing.resumed',
          title: 'Publicação retomada',
          body: 'Os posts agendados que venceram saem no próximo ciclo.',
          link: '/agenda',
        });
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return apiError(e, 'api/pause');
  }
}
