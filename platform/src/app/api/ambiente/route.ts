// Estado do ambiente de teste (staging sob demanda, SPEC 016): ligado, ligando, dormindo ou com erro.
// Público de propósito: com o banco parado ninguém consegue sessão. Só devolve o estado e o tempo,
// nada do projeto. Fora do staging (WAKE_ENABLED desligado) responde 404.

import { NextResponse } from 'next/server';
import { powerClient, powerConfig, probeDb, statusOf, type EnvStatus } from '@/lib/env-power';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const config = powerConfig();
  if (!config) return NextResponse.json({ error: 'Não encontrado' }, { status: 404, headers });

  const now = Date.now();
  if (await probeDb(process.env.DATABASE_URL)) {
    return NextResponse.json(statusOf({ dbReachable: true, policy: null, lastOp: null, nowMs: now }), { headers });
  }
  let status: EnvStatus;
  try {
    const power = powerClient(config);
    const [policy, lastOp] = await Promise.all([power.policy(), power.lastUpdate()]);
    status = statusOf({ dbReachable: false, policy, lastOp, nowMs: now });
  } catch (e) {
    logError('ambiente', e);
    status = statusOf({ dbReachable: false, policy: null, lastOp: null, nowMs: now, apiError: 'Não consegui consultar o Cloud SQL.' });
  }
  return NextResponse.json(status, { headers });
}
