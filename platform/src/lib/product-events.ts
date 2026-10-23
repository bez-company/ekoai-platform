// product-events.ts: eventos de produto que dependem de dado do banco (BEZ-260, ADR 0017): o fim de
// uma geração (post_ready ou post_generation_failed) e o custo por etapa. Só número, enum e o id do
// pedido; nada do texto do post, da ideia ou da conta de quem pediu.

import type { TenantDb } from './tenant-db';
import { analyticsEnabled, track } from './analytics';
import type { GenerationOutcome } from './generation';
import { log } from './log';

export type RunRow = { step: string; status: string; cost_usd: number | string | null; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; images: number | null };
export type StepCost = { step: string; calls: number; failed_calls: number; cost_usd: number; duration_ms: number; input_tokens: number; output_tokens: number; images: number };

// Soma as chamadas de modelo de um pedido por etapa. Chamada que falhou conta em `failed_calls` e o
// custo dela (quando houve) entra no total: custo por post aprovado inclui regeneração e falha.
export function costByStep(rows: RunRow[]): StepCost[] {
  const steps = new Map<string, StepCost>();
  for (const r of rows) {
    const s = steps.get(r.step) ?? { step: r.step, calls: 0, failed_calls: 0, cost_usd: 0, duration_ms: 0, input_tokens: 0, output_tokens: 0, images: 0 };
    s.calls += 1;
    if (r.status === 'failed') s.failed_calls += 1;
    s.cost_usd += Number(r.cost_usd ?? 0);
    s.duration_ms += r.duration_ms ?? 0;
    s.input_tokens += r.input_tokens ?? 0;
    s.output_tokens += r.output_tokens ?? 0;
    s.images += r.images ?? 0;
    steps.set(r.step, s);
  }
  return [...steps.values()].map((s) => ({ ...s, cost_usd: Math.round(s.cost_usd * 1e6) / 1e6 }));
}

// Chamado pelo worker depois de cada pedido. Nunca derruba o worker: falha vira aviso.
export async function trackGenerationOutcome(t: TenantDb, outcome: GenerationOutcome, elapsedMs: number): Promise<void> {
  if (!analyticsEnabled()) return;
  try {
    const [runs, brief] = await Promise.all([
      t.select('generation_runs', 'step,status,cost_usd,duration_ms,input_tokens,output_tokens,images').eq('brief_id', outcome.briefId),
      t.select('briefs', 'direction,post_kind,goal,ratio').eq('id', outcome.briefId).maybeSingle(),
    ]);
    const steps = costByStep((runs.data ?? []) as RunRow[]);
    const direction = Number(brief.data?.direction ?? 1);
    const common = { brief_id: outcome.briefId, direction, regenerated: direction > 1, kind: (brief.data?.post_kind as string | null) ?? null, goal: (brief.data?.goal as string | null) ?? null };
    const totalCost = Math.round(steps.reduce((sum, s) => sum + s.cost_usd, 0) * 1e6) / 1e6;
    if (outcome.status === 'ready') await track(t.tenantId, 'post_ready', { ...common, ratio: (brief.data?.ratio as string | null) ?? null, latency_ms: elapsedMs, cost_usd: totalCost });
    else await track(t.tenantId, 'post_generation_failed', { ...common, outcome: outcome.status, latency_ms: elapsedMs, cost_usd: totalCost });
    for (const s of steps) await track(t.tenantId, 'cost_by_step', { brief_id: outcome.briefId, direction, ...s });
  } catch (e) {
    log('warn', 'analytics', 'evento da geração não enviado', { reason: e instanceof Error ? e.message : String(e) });
  }
}
