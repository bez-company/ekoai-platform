// generation-worker.ts: a fila de pedidos de post (ADR 0018). O pedido só grava o brief; quem gera
// é este worker, chamado por /api/cron/generate (acordado pelo pedido e, de reserva, pelo Cloud
// Scheduler). Uso de sistema: varre os briefs na fila de todas as contas, por isso usa o acesso cru
// ao banco (lista de tests/tenant-scope); o trabalho de cada brief roda pelo tenantDb da conta.

import { db } from './db';
import { tenantDb } from './tenant-db';
import { generatePost, type GenerationDeps, type GenerationOutcome } from './generation';
import { vertexClient } from './vertex';
import { log, logError } from './log';

export const WORKER_BATCH = 3;
export const WORKER_BUDGET_MS = 240_000; // abaixo do timeout do Cloud Run (300 s)
export const STALE_AFTER_MINUTES = 15;

type Claimed = { id: string; tenant_id: string };

// Pega até N briefs da fila, marcando-os como em geração na mesma instrução (duas instâncias do
// worker nunca pegam o mesmo). Brief "em geração" há mais de 15 minutos é de um worker que caiu:
// volta para a fila.
export async function claimQueued(limit = WORKER_BATCH, query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> = (t, p) => db().query(t, p)): Promise<Claimed[]> {
  const { rows } = await query(
    `with picked as (
       select id from briefs
       where source = 'platform'
         and (status = 'queued' or (status = 'generating' and updated_at < now() - make_interval(mins => $2)))
       order by created_at
       limit $1
       for update skip locked
     )
     update briefs b set status = 'generating', updated_at = now()
     from picked where b.id = picked.id
     returning b.id, b.tenant_id`,
    [limit, STALE_AFTER_MINUTES],
  );
  return rows as Claimed[];
}

export type WorkerSummary = { claimed: number; ready: number; failed: number; limit: number; outcomes: GenerationOutcome[] };

export async function runGenerateQueue(deps?: Partial<GenerationDeps>, options: { limit?: number; budgetMs?: number; now?: () => number } = {}): Promise<WorkerSummary> {
  const started = (options.now ?? Date.now)();
  const model = deps?.model ?? vertexClient();
  const claimed = await claimQueued(options.limit ?? WORKER_BATCH);
  const summary: WorkerSummary = { claimed: claimed.length, ready: 0, failed: 0, limit: 0, outcomes: [] };
  for (const brief of claimed) {
    if ((options.now ?? Date.now)() - started > (options.budgetMs ?? WORKER_BUDGET_MS)) {
      // Devolve à fila o que não deu tempo de gerar: a próxima chamada continua.
      await db().query("update briefs set status = 'queued' where id = $1 and status = 'generating'", [brief.id]);
      continue;
    }
    try {
      const outcome = await generatePost(tenantDb(brief.tenant_id), brief.id, { ...deps, model });
      summary.outcomes.push(outcome);
      summary[outcome.status] += 1;
      log('info', 'generation-worker', 'pedido processado', { briefId: brief.id, status: outcome.status });
    } catch (e) {
      summary.failed += 1;
      logError('generation-worker', e, { briefId: brief.id });
    }
  }
  return summary;
}
