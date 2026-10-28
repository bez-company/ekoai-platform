// generation-db.ts: as chamadas de modelo no banco (SPEC 012 R5.1). Reservar antes de chamar,
// concluir ou falhar depois. A reserva é um insert que, repetido com a mesma chave (conta, pedido,
// etapa, hash da entrada), devolve a linha que já existe: pedido repetido não chama o modelo e não
// cobra. No visual, o gatilho do banco aplica o limite mensal do plano com lock por conta.

import type { TenantDb } from './tenant-db';
import type { Channel } from './types';
import { isPlanPostsLimit, monthStart, runFromRow, usageOf, type GenerationRun, type Step, type Usage } from './generation-model';

export type ReserveInput = { briefId: string; step: Step; inputHash: string; model: string; channel?: Channel }; // channel: a rede da chamada (SPEC 028); sem ele, a chamada é do pedido todo

export type Reservation =
  | { ok: true; run: GenerationRun; reused: boolean }
  | { ok: false; reason: 'limit'; usage: Usage };

const COLUMNS = 'id,brief_id,step,input_hash,status,model,model_version,input_tokens,output_tokens,images,cost_usd,duration_ms,result,error,created_at,finished_at';

async function findRun(t: TenantDb, input: ReserveInput): Promise<GenerationRun | null> {
  const { data, error } = await t
    .select('generation_runs', COLUMNS)
    .eq('brief_id', input.briefId)
    .eq('step', input.step)
    .eq('input_hash', input.inputHash)
    .maybeSingle();
  if (error) throw new Error(`generation_runs: ${error.message}`);
  return data ? runFromRow(data) : null;
}

// Reserva a chamada. `reused` diz que a linha já existia (concluída ou em andamento); quem chama
// decide o que fazer com cada estado. Linha falhada é reaproveitada: vira reserva de novo. A linha
// existente é procurada ANTES do insert: o gatilho de limite roda antes do `on conflict`, e a
// repetição de um pedido nunca pode ser barrada pelo limite (ela não chama o modelo).
export async function reserveRun(t: TenantDb, input: ReserveInput, planMax: number): Promise<Reservation> {
  const known = await findRun(t, input);
  if (known && known.status !== 'failed') return { ok: true, run: known, reused: true };
  if (known) return retryFailed(t, input, known, planMax);

  const inserted = await t
    .upsert(
      'generation_runs',
      { brief_id: input.briefId, step: input.step, input_hash: input.inputHash, model: input.model, channel: input.channel ?? null, status: 'reserved' },
      { onConflict: 'tenant_id,brief_id,step,input_hash', ignoreDuplicates: true },
    )
    .select(COLUMNS);
  if (inserted.error) {
    if (isPlanPostsLimit(inserted.error)) return { ok: false, reason: 'limit', usage: await monthlyUsage(t, planMax) };
    throw new Error(`generation_runs: ${inserted.error.message}`);
  }
  const row = inserted.data?.[0];
  if (row) return { ok: true, run: runFromRow(row), reused: false };

  // Duas reservas iguais ao mesmo tempo: a segunda perde o insert e lê a linha da primeira.
  const existing = await findRun(t, input);
  if (!existing) throw new Error('generation_runs: a reserva não gravou nem encontrou a linha');
  if (existing.status !== 'failed') return { ok: true, run: existing, reused: true };
  return retryFailed(t, input, existing, planMax);
}

// Tentar de novo depois de uma falha: a linha volta a reservada. O gatilho confere o limite só no
// insert, e a falha não ocupava vaga, então a vaga é conferida aqui.
async function retryFailed(t: TenantDb, input: ReserveInput, existing: GenerationRun, planMax: number): Promise<Reservation> {
  if (input.step === 'visual') {
    const usage = await monthlyUsage(t, planMax);
    if (usage.remaining <= 0) return { ok: false, reason: 'limit', usage };
  }
  const { data, error } = await t
    .update('generation_runs', { status: 'reserved', error: null, finished_at: null, model: input.model })
    .eq('id', existing.id)
    .select(COLUMNS);
  if (error) throw new Error(`generation_runs: ${error.message}`);
  return { ok: true, run: runFromRow(data![0]), reused: false };
}

export type RunOutcome = {
  result?: unknown;
  modelVersion?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  images?: number;
  costUsd?: number | null;
  durationMs?: number | null;
};

export async function completeRun(t: TenantDb, id: string, outcome: RunOutcome): Promise<void> {
  const { error } = await t
    .update('generation_runs', {
      status: 'done',
      result: outcome.result ?? null,
      model_version: outcome.modelVersion ?? null,
      input_tokens: outcome.inputTokens ?? null,
      output_tokens: outcome.outputTokens ?? null,
      images: outcome.images ?? 0,
      cost_usd: outcome.costUsd ?? null,
      duration_ms: outcome.durationMs ?? null,
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`generation_runs: ${error.message}`);
}

export async function failRun(t: TenantDb, id: string, message: string, durationMs?: number): Promise<void> {
  const { error } = await t
    .update('generation_runs', { status: 'failed', error: message.slice(0, 1000), duration_ms: durationMs ?? null, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`generation_runs: ${error.message}`);
}

// Posts do mês: visuais reservados ou concluídos desde o dia 1º (UTC), contra o máximo do plano.
export async function monthlyUsage(t: TenantDb, planMax: number): Promise<Usage> {
  const { count, error } = await t
    .select('generation_runs', 'id', { count: 'exact', head: true })
    .eq('step', 'visual')
    .in('status', ['reserved', 'done'])
    .gte('created_at', monthStart());
  if (error) throw new Error(`generation_runs: ${error.message}`);
  return usageOf(count ?? 0, planMax);
}

// As chamadas de um pedido, na ordem: a tela de andamento lê daqui.
export async function runsOfBrief(t: TenantDb, briefId: string): Promise<GenerationRun[]> {
  const { data, error } = await t.select('generation_runs', COLUMNS).eq('brief_id', briefId).order('created_at', { ascending: true });
  if (error) throw new Error(`generation_runs: ${error.message}`);
  return (data ?? []).map(runFromRow);
}
