// Renovação diária dos tokens de Instagram (SPEC 011 R5.3), disparada pelo Cloud Scheduler com token
// OIDC (ou por `Authorization: Bearer <CRON_SECRET>` à mão). Sem credencial válida, recusa: ver
// lib/cron-auth.ts. A resposta traz só contagens, nunca token nem conta.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runInstagramRefresh } from '@/lib/instagram-refresh';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runInstagramRefresh()) });
  } catch (e) {
    logError('cron/refresh-instagram', e);
    return NextResponse.json({ error: 'falha na renovação' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
