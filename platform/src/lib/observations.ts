// observations.ts: lê e grava a escolha de quem gere a marca sobre as observações do público (SPEC 022,
// BEZ-206) e entrega as dicas ligadas ao planejador de ideias. Server-only. A observação em si é calculada
// na hora (observations-model.ts); aqui só fica a escolha, e só quem tem brand.manage grava (a rota confere).

import { loadAnalysis } from './content-analysis';
import { OBSERVATION_KEYS, buildObservations, plannerHints, type Observation, type ObservationKey } from './observations-model';
import type { TenantDb } from './tenant-db';

export async function enabledObservations(t: TenantDb): Promise<ObservationKey[]> {
  const { data, error } = await t.select('observation_settings', 'key,enabled');
  if (error) throw new Error(`observation_settings: ${error.message}`);
  return (data ?? []).filter((r) => r.enabled === true && (OBSERVATION_KEYS as readonly string[]).includes(String(r.key))).map((r) => String(r.key) as ObservationKey);
}

export async function setObservation(t: TenantDb, userId: string | null, key: ObservationKey, enabled: boolean): Promise<void> {
  const { error } = await t.upsert('observation_settings', { key, enabled, decided_by: userId, decided_at: new Date().toISOString() }, { onConflict: 'tenant_id,key' });
  if (error) throw new Error(`observation_settings: ${error.message}`);
}

export type ObservationsView = { observations: Observation[]; enabled: ObservationKey[]; lastReadOn: string | null };

// Para a tela: as observações de agora e quais estão ligadas.
export async function loadObservations(t: TenantDb, nowMs = Date.now()): Promise<ObservationsView> {
  const [analysis, enabled] = await Promise.all([loadAnalysis(t, nowMs), enabledObservations(t)]);
  const observations = buildObservations({ breakdown: analysis.breakdown, insight: analysis.insight, audience: analysis.audience, recommendation: analysis.recommendation });
  return { observations, enabled, lastReadOn: analysis.audience?.capturedOn ?? null };
}

// Para o planejador: o texto das observações ligadas. Sem nenhuma ligada, nem lê os posts.
export async function loadPlannerHints(t: TenantDb, nowMs = Date.now()): Promise<string[]> {
  const enabled = await enabledObservations(t);
  if (!enabled.length) return [];
  const view = await loadObservations(t, nowMs);
  return plannerHints(view.observations, view.enabled);
}
