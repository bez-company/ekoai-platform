// generation-worker.ts: a fila de pedidos de post (ADR 0018). O pedido só grava o brief; quem gera
// é este worker, chamado por /api/cron/generate (acordado pelo pedido e, de reserva, pelo Cloud
// Scheduler). Uso de sistema: varre os briefs na fila de todas as contas, por isso usa o acesso cru
// ao banco (lista de tests/tenant-scope); o trabalho de cada brief roda pelo tenantDb da conta.

import { db } from './db';
import { tenantDb } from './tenant-db';
import { generatePost, type GenerationDeps, type GenerationOutcome } from './generation';
import { vertexClient } from './vertex';
import { log, logError } from './log';
import { trackGenerationOutcome } from './product-events';
import { fallbackReasonFor } from './studio/levels';
import { dispatchStudioJob, needsStudioJob, studioJobName, type DispatchDeps } from './studio/dispatch';

export const WORKER_BATCH = 3;
export const WORKER_BUDGET_MS = 240_000; // abaixo do timeout do Cloud Run (300 s)
export const STALE_AFTER_MINUTES = 15;

// `stale`: o pedido estava "em geração" parado (um worker ou um job caiu): não volta ao estúdio, vai para o caminho de sempre.
type Claimed = { id: string; tenant_id: string; effort: string; stale: boolean };

// Pega até N briefs da fila, marcando-os como em geração na mesma instrução (duas instâncias do
// worker nunca pegam o mesmo). Brief "em geração" há mais de 15 minutos é de um worker que caiu:
// volta para a fila.
export async function claimQueued(limit = WORKER_BATCH, query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> = (t, p) => db().query(t, p)): Promise<Claimed[]> {
  const { rows } = await query(
    `with picked as (
       select id, status as prev from briefs
       where source = 'platform'
         and not exists (select 1 from tenants t where t.id = briefs.tenant_id and t.status = 'suspended')
         and (status = 'queued' or (status = 'generating' and updated_at < now() - make_interval(mins => $2)))
       order by created_at
       limit $1
       for update skip locked
     )
     update briefs b set status = 'generating', updated_at = now()
     from picked where b.id = picked.id
     returning b.id, b.tenant_id, b.effort, (picked.prev = 'generating') as stale`,
    [limit, STALE_AFTER_MINUTES],
  );
  return rows as Claimed[];
}

export type WorkerSummary = { claimed: number; ready: number; failed: number; limit: number; dispatched: number; outcomes: GenerationOutcome[] };

export async function runGenerateQueue(deps?: Partial<GenerationDeps>, options: { limit?: number; budgetMs?: number; now?: () => number; studio?: { jobName?: string | null } & DispatchDeps } = {}): Promise<WorkerSummary> {
  const started = (options.now ?? Date.now)();
  const model = deps?.model ?? vertexClient();
  const claimed = await claimQueued(options.limit ?? WORKER_BATCH);
  const summary: WorkerSummary = { claimed: claimed.length, ready: 0, failed: 0, limit: 0, dispatched: 0, outcomes: [] };
  const studioJob = options.studio && 'jobName' in options.studio ? options.studio.jobName ?? null : studioJobName();
  for (const brief of claimed) {
    if ((options.now ?? Date.now)() - started > (options.budgetMs ?? WORKER_BUDGET_MS)) {
      // Devolve à fila o que não deu tempo de gerar: a próxima chamada continua.
      await db().query("update briefs set status = 'queued' where id = $1 and status = 'generating'", [brief.id]);
      continue;
    }
    try {
      // Nível com cadeia de agentes (Refinado, Autoral): vai para o job do estúdio e o pedido segue "em geração". Sem job configurado, com o
      // pedido parado de antes ou se o disparo falhar, o pedido vira Rápido e sai pelo caminho de sempre (SPEC 030, decisão 6).
      if (needsStudioJob(brief.effort)) {
        let sent = false;
        if (studioJob && !brief.stale) {
          try {
            await dispatchStudioJob(studioJob, { tenantId: brief.tenant_id, briefId: brief.id }, options.studio);
            sent = true;
          } catch (e) {
            logError('generation-worker', e, { briefId: brief.id, step: 'disparo do job do estúdio' });
          }
        }
        if (sent) {
          summary.dispatched += 1;
          log('info', 'generation-worker', 'pedido enviado ao job do estúdio', { briefId: brief.id, effort: brief.effort });
          continue;
        }
        const { error } = await tenantDb(brief.tenant_id).update('briefs', { effort: 'instantaneo', fallback_from: brief.effort, fallback_reason: fallbackReasonFor('o estúdio não está disponível agora') }).eq('id', brief.id);
        if (error) throw new Error(`briefs: ${error.message}`);
      }
      const t = tenantDb(brief.tenant_id);
      const startedBrief = (options.now ?? Date.now)();
      const outcome = await generatePost(t, brief.id, { critic: true, ...deps, model });
      await trackGenerationOutcome(t, outcome, (options.now ?? Date.now)() - startedBrief);
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
