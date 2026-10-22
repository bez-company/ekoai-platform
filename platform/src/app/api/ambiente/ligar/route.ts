// "Ligar o ambiente": põe o Cloud SQL do staging em ALWAYS (SPEC 016). Público de propósito, pelo mesmo
// motivo do GET /api/ambiente. O pior abuso é ligar o banco (cerca de R$ 0,09 por hora), e o corte
// por ociosidade o desliga de novo. Um pedido a cada 2 minutos por instância; vem do botão da tela,
// não do GET, para robô e prévia de link não ligarem o banco sem querer.

import { NextResponse } from 'next/server';
import { canWakeNow, markWake, powerClient, powerConfig, probeDb, statusOf } from '@/lib/env-power';
import { logError, log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function POST() {
  const config = powerConfig();
  if (!config) return NextResponse.json({ error: 'Não encontrado' }, { status: 404, headers });

  const now = Date.now();
  if (await probeDb(process.env.DATABASE_URL)) {
    return NextResponse.json(statusOf({ dbReachable: true, policy: null, lastOp: null, nowMs: now }), { headers });
  }
  try {
    const power = powerClient(config);
    let policy = await power.policy();
    if (policy === 'NEVER' && canWakeNow(now)) {
      markWake(now);
      await power.setPolicy('ALWAYS');
      log('info', 'ambiente', 'banco ligado pela tela de espera');
      policy = 'ALWAYS';
    }
    const lastOp = await power.lastUpdate();
    return NextResponse.json(statusOf({ dbReachable: false, policy, lastOp, nowMs: now }), { status: 202, headers });
  } catch (e) {
    logError('ambiente/ligar', e);
    return NextResponse.json(statusOf({ dbReachable: false, policy: null, lastOp: null, nowMs: now, apiError: 'Não consegui ligar o banco.' }), { status: 502, headers });
  }
}
