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

// Acorda o worker e ESPERA a resposta (até `timeoutMs`). Para quem termina logo depois, como o job do estúdio: o processo sai e uma chamada
// "dispara e esquece" nem chega a sair. A rota processa a fila inteira antes de responder, então a espera cobre a geração do pedido
// devolvido; passar do prazo ou falhar só vai ao log (o Scheduler, quando ligado, pega a fila).
export async function wakeWorkerAndWait(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch, timeoutMs = 150_000): Promise<void> {
  const base = env.APP_BASE_URL;
  const secret = env.CRON_SECRET;
  if (!base || !secret) {
    log('warn', 'worker-wake', 'sem APP_BASE_URL ou CRON_SECRET: a geração espera o Scheduler');
    return;
  }
  try {
    const res = await fetchImpl(`${base}/api/cron/generate`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) log('warn', 'worker-wake', 'o worker recusou o aviso', { status: res.status });
  } catch (e) {
    log('warn', 'worker-wake', 'não acordou o worker; o Scheduler pega a fila', { error: e instanceof Error ? e.message : String(e) });
  }
}
