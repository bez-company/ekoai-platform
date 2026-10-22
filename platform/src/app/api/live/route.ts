// Liveness: só diz que o processo está de pé, sem tocar no banco. O /api/health faz `select 1` e
// por isso fica 503 com o banco parado; o staging sob demanda usa este caminho nos probes do Cloud
// Run para a plataforma subir e mostrar a tela "Ligar o ambiente" (SPEC 016, BEZ-120).

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
