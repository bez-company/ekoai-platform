// O worker da geração (ADR 0018): processa a fila de pedidos de post. Chamado pelo próprio pedido
// (Bearer CRON_SECRET) e, de reserva, pelo Cloud Scheduler (token OIDC). Sem credencial válida,
// recusa: ver lib/cron-auth.ts. Roda até 3 pedidos por chamada, dentro do timeout do serviço.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runGenerateQueue } from '@/lib/generation-worker';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const summary = await runGenerateQueue();
    return NextResponse.json({ ok: true, claimed: summary.claimed, ready: summary.ready, failed: summary.failed, limit: summary.limit, dispatched: summary.dispatched });
  } catch (e) {
    logError('cron/generate', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
