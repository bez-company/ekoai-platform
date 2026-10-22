// wake-gate.ts: a tela de espera do staging (SPEC 016). O layout raiz pergunta aqui se o banco
// está dormindo; só o staging liga WAKE_ENABLED, então na produção a resposta é sempre "não" e
// sem custo. O resultado fica na memória da instância: banco de pé vale 30 s, banco fora vale 3 s.

import { powerEnabled, probeDb } from './env-power';

let cache: { at: number; ok: boolean } | null = null;

export async function environmentAsleep(probe: (url: string | undefined) => Promise<boolean> = probeDb, nowMs: number = Date.now()): Promise<boolean> {
  if (!powerEnabled()) return false;
  if (cache && nowMs - cache.at < (cache.ok ? 30_000 : 3_000)) return !cache.ok;
  const ok = await probe(process.env.DATABASE_URL);
  cache = { at: nowMs, ok };
  return !ok;
}

export function resetWakeGate(): void {
  cache = null;
}
