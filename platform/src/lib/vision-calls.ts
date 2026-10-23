// vision-calls.ts: teto diário por conta nas chamadas de visão (BEZ-244, migration 0033). Cada chamada
// reserva uma linha em vision_calls antes de ir ao modelo; o gatilho do banco barra a reserva acima do
// teto do dia, com lock por conta, então duas chamadas ao mesmo tempo na última vaga não passam juntas.
// Ao fim a linha guarda tokens e custo (painel de custo por conta, BEZ-91); falha libera a vaga.

import type { TenantDb } from './tenant-db';
import { track } from './analytics';
import type { TextResult } from './vertex';

export const VISION_KINDS = ['photo_caption', 'media_describe'] as const;
export type VisionKind = (typeof VISION_KINDS)[number];

export function isVisionCapError(error: { hint?: string | null } | null | undefined): boolean {
  return !!error && error.hint === 'vision_daily';
}

// O texto que a pessoa lê quando a legenda pela foto bate no teto: o que houve e o próximo passo.
export const CAPTION_CAP_MESSAGE = 'A Ekoai já escreveu o máximo de legendas pela foto de hoje nesta conta. Escreva a legenda você, ou peça de novo amanhã.';

export type VisionReservation = { ok: true; id: string } | { ok: false };

export async function reserveVision(t: TenantDb, kind: VisionKind, targetId: string | null): Promise<VisionReservation> {
  const { data, error } = await t.insert('vision_calls', { kind, target_id: targetId, status: 'reserved' }).select('id');
  if (error) {
    if (isVisionCapError(error)) return { ok: false };
    throw new Error(`vision_calls: ${error.message}`);
  }
  return { ok: true, id: String(data![0].id) };
}

export async function finishVision(t: TenantDb, id: string, outcome: { result: TextResult } | { error: string }): Promise<void> {
  const fields =
    'result' in outcome
      ? { status: 'done', model_version: outcome.result.modelVersion, input_tokens: outcome.result.inputTokens, output_tokens: outcome.result.outputTokens, cost_usd: outcome.result.costUsd }
      : { status: 'failed', error: outcome.error.slice(0, 500) };
  const { error } = await t.update('vision_calls', { ...fields, finished_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`vision_calls: ${error.message}`);
}

// Reserva, chama e fecha a linha. Devolve null quando a conta bateu no teto do dia (o modelo não é chamado).
export async function withVisionBudget(t: TenantDb, kind: VisionKind, targetId: string | null, call: () => Promise<TextResult>): Promise<TextResult | null> {
  const r = await reserveVision(t, kind, targetId);
  if (!r.ok) return null;
  try {
    const result = await call();
    await finishVision(t, r.id, { result });
    await track(t.tenantId, 'cost_by_step', { step: `vision_${kind}`, calls: 1, failed_calls: 0, cost_usd: result.costUsd, duration_ms: result.durationMs, input_tokens: result.inputTokens, output_tokens: result.outputTokens });
    return result;
  } catch (e) {
    await finishVision(t, r.id, { error: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
    await track(t.tenantId, 'cost_by_step', { step: `vision_${kind}`, calls: 1, failed_calls: 1, cost_usd: 0 });
    throw e;
  }
}
