// Renovação e aviso diários do LinkedIn (SPEC 028, BEZ-423), disparados pelo Cloud Scheduler com token OIDC (ou por
// `Authorization: Bearer <CRON_SECRET>` à mão). Sem credencial válida, recusa: ver lib/cron-auth.ts. A resposta traz só contagens.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runLinkedInRefresh } from '@/lib/linkedin-refresh';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runLinkedInRefresh()) });
  } catch (e) {
    logError('cron/refresh-linkedin', e);
    return NextResponse.json({ error: 'falha na renovação' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
