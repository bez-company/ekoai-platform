// Health check público: diz se o app alcança o banco, sem expor detalhe do erro.
// 200 = tudo ok; 503 = alguma dependência fora. É o probe de inicialização do Cloud Run e o
// alvo do uptime check. A versão é a revisão do Cloud Run (K_REVISION), ou APP_VERSION se o deploy a definir.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appVersion } from '@/lib/app-version';

export const dynamic = 'force-dynamic';

async function checkDb(): Promise<boolean> {
  try {
    await db().query('select 1');
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const dbOk = await checkDb();
  return NextResponse.json(
    { status: dbOk ? 'ok' : 'degraded', checks: { db: dbOk ? 'ok' : 'fail' }, version: appVersion() },
    { status: dbOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
