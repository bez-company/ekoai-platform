// job.ts: o que o Cloud Run Job `ekoai-studio` faz por execução (SPEC 030 F3c, ADR 0028): gera UM post do estúdio e termina. O worker de
// geração dispara a execução com STUDIO_TENANT e STUDIO_BRIEF e deixa o pedido "em geração"; aqui o pedido bate o coração a cada etapa.
//
// Qualquer coisa que não entregue o post (erro do motor, exceção, timeout do chamador) devolve o pedido à fila no nível Rápido, que o worker
// gera pelo caminho de sempre (ADR 0028, decisão 5; SPEC 030, decisão 6). Nunca deixa o pedido preso em "em geração".

import type { TenantDb } from '../tenant-db';
import { log } from '../log';
import { generateStudioPost, type StudioGenerationDeps, type StudioOutcome } from './generate';

export type JobInput = { tenantId: string; briefId: string };

export function jobInputFrom(env: Record<string, string | undefined>): JobInput {
  const tenantId = env.STUDIO_TENANT?.trim();
  const briefId = env.STUDIO_BRIEF?.trim();
  if (!tenantId || !briefId || !/^[0-9a-f-]{36}$/i.test(briefId)) throw new Error('STUDIO_TENANT e STUDIO_BRIEF (uuid) são obrigatórios.');
  return { tenantId, briefId };
}

// Devolve o pedido à fila como Rápido: o worker o pega e gera pelo motor de hoje.
export async function requeueAsQuick(t: TenantDb, briefId: string, reason: string): Promise<void> {
  log('warn', 'studio-job', 'o pedido volta para o Rápido', { briefId, reason: reason.slice(0, 300) });
  const { error } = await t.update('briefs', { effort: 'instantaneo', status: 'queued', error: null }).eq('id', briefId).eq('status', 'generating');
  if (error) throw new Error(`briefs: ${error.message}`);
}

export async function runStudioJob(t: TenantDb, input: JobInput, deps: StudioGenerationDeps): Promise<StudioOutcome> {
  const beat = () => void t.update('briefs', { updated_at: new Date().toISOString() }).eq('id', input.briefId).then(() => undefined, () => undefined);
  let outcome: StudioOutcome;
  try {
    outcome = await generateStudioPost(t, input.briefId, { ...deps, onStage: (stage) => { beat(); deps.onStage?.(stage); } });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await requeueAsQuick(t, input.briefId, reason);
    return { status: 'fallback', briefId: input.briefId, reason };
  }
  if (outcome.status === 'fallback') await requeueAsQuick(t, input.briefId, outcome.reason);
  log('info', 'studio-job', 'execução concluída', { briefId: input.briefId, status: outcome.status });
  return outcome;
}
