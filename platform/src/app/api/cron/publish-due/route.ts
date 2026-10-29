// Endpoint do scheduler, disparado pelo Cloud Scheduler a cada 10 minutos com token OIDC (ou
// por `Authorization: Bearer <CRON_SECRET>` à mão). Sem credencial válida, recusa: ver
// lib/cron-auth.ts.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { powerConfig, probeDb } from '@/lib/env-power';
import { reconcileStalePublishing, runPublishDue } from '@/lib/publish';
import { runStaleApprovals } from '@/lib/stale-approvals';
import { log, logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  // Staging sob demanda (SPEC 016): com o banco dormindo ou ligando não há post a publicar (o sleep-if-idle só
  // desliga sem post agendado esperando), e tentar o banco estoura o prazo e acende o alerta do Scheduler (BEZ-482).
  // Fora do staging powerConfig() é nulo e nada muda: no prod uma falha de banco continua sendo erro.
  if (powerConfig() && !(await probeDb(process.env.DATABASE_URL))) {
    return NextResponse.json({ ok: true, skipped: 'ambiente dormindo ou ligando' });
  }
  try {
    // Primeiro quem ficou preso em `publishing` (a Meta é consultada antes de qualquer nova tentativa);
    // falha aqui não pode impedir os vencidos de sair.
    const reconciled = await reconcileStalePublishing().catch((e) => {
      logError('cron/publish-due reconcile', e);
      return null;
    });
    if (reconciled && reconciled.checked) log(reconciled.failed || reconciled.errors ? 'warn' : 'info', 'cron/publish-due', 'posts presos reconciliados', reconciled);
    const summary = await runPublishDue();
    // O corpo da resposta não vai para o Cloud Logging: sem esta linha, não há como saber o que o ciclo fez.
    log(summary.failed > 0 ? 'warn' : 'info', 'cron/publish-due', 'ciclo concluído', summary);
    // Posts esquecidos em Aprovar (SPEC 017, decisão 12): falha aqui não pode derrubar a publicação.
    const stale = await runStaleApprovals().catch((e) => {
      logError('cron/publish-due stale', e);
      return null;
    });
    if (stale && (stale.warned || stale.asked)) log('info', 'cron/publish-due', 'avisos de post esquecido', stale);
    return NextResponse.json({ ok: true, ...summary, reconciled, stale });
  } catch (e) {
    logError('cron/publish-due', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
