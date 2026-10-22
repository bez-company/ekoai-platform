// Desliga o banco do staging sem uso (SPEC 016). O Cloud Scheduler chama a cada 15 minutos com
// token OIDC (lib/cron-auth.ts). Só desliga com a janela inteira de ociosidade sem nenhuma
// requisição de gente; qualquer dúvida (métrica ausente, API fora) deixa o banco ligado.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { powerClient, powerConfig, sleepDecision } from '@/lib/env-power';
import { log, logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const config = powerConfig();
  if (!config) return NextResponse.json({ ok: true, action: 'none', reason: 'staging sob demanda desligado neste ambiente' });
  try {
    const power = powerClient(config);
    const policy = await power.policy();
    if (policy !== 'ALWAYS') return NextResponse.json({ ok: true, action: 'none', reason: sleepDecision({ policy, lastOpStartMs: null, requests: 0, nowMs: Date.now(), idleMinutes: config.idleMinutes }).reason });
    const [lastOp, requests] = await Promise.all([power.lastUpdate(), power.userRequests(config.idleMinutes)]);
    const decision = sleepDecision({ policy, lastOpStartMs: lastOp?.startedAtMs ?? null, requests, nowMs: Date.now(), idleMinutes: config.idleMinutes });
    if (decision.stop) {
      await power.setPolicy('NEVER');
      log('info', 'cron/sleep-if-idle', 'banco desligado por ociosidade', { reason: decision.reason });
    }
    return NextResponse.json({ ok: true, action: decision.stop ? 'stopped' : 'none', reason: decision.reason, requests });
  } catch (e) {
    logError('cron/sleep-if-idle', e);
    return NextResponse.json({ ok: false, action: 'none', reason: 'falha ao decidir; o banco continua ligado' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
