// Endpoint do scheduler, disparado pelo Cloud Scheduler a cada 10 minutos com token OIDC (ou
// por `Authorization: Bearer <CRON_SECRET>` à mão). Sem credencial válida, recusa: ver
// lib/cron-auth.ts.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runPublishDue } from '@/lib/publish';
import { runStaleApprovals } from '@/lib/stale-approvals';
import { log, logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const summary = await runPublishDue();
    // O corpo da resposta não vai para o Cloud Logging: sem esta linha, não há como saber o que o ciclo fez.
    log(summary.failed > 0 ? 'warn' : 'info', 'cron/publish-due', 'ciclo concluído', summary);
    // Posts esquecidos em Aprovar (SPEC 017, decisão 12): falha aqui não pode derrubar a publicação.
    const stale = await runStaleApprovals().catch((e) => {
      logError('cron/publish-due stale', e);
      return null;
    });
    if (stale && (stale.warned || stale.asked)) log('info', 'cron/publish-due', 'avisos de post esquecido', stale);
    return NextResponse.json({ ok: true, ...summary, stale });
  } catch (e) {
    logError('cron/publish-due', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
