// worker-wake.ts: acorda o worker de geração (ADR 0018) sem esperar por ele. Módulo à parte para o job do estúdio usá-lo sem puxar o
// resto de post-requests.

import { log } from './log';

// Acorda o worker sem esperar por ele: o pedido responde na hora e a geração segue por fora. Se a
// chamada falhar, o Cloud Scheduler pega a fila no próximo minuto.
export function wakeWorker(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): void {
  const base = env.APP_BASE_URL;
  const secret = env.CRON_SECRET;
  if (!base || !secret) {
    log('warn', 'post-requests', 'sem APP_BASE_URL ou CRON_SECRET: a geração espera o Scheduler');
    return;
  }
  fetchImpl(`${base}/api/cron/generate`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } }).catch((e) =>
    log('warn', 'post-requests', 'não acordou o worker; o Scheduler pega a fila', { error: e instanceof Error ? e.message : String(e) }),
  );
}
