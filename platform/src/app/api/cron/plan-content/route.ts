// Planejamento diário do coordenador de conteúdo (SPEC 017 decisão 8, BEZ-239), disparado pelo Cloud
// Scheduler com token OIDC (ou por `Authorization: Bearer <CRON_SECRET>` à mão). Sem credencial
// válida, recusa: ver lib/cron-auth.ts. A resposta traz só contagens. No staging com o banco dormindo
// (SPEC 016) não acorda o banco: sugestão não vale o custo de ligar, e o dia seguinte refaz.

import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runContentPlanning } from '@/lib/content-coordinator';
import { environmentAsleep } from '@/lib/wake-gate';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    if (await environmentAsleep()) return NextResponse.json({ ok: true, skipped: 'asleep' });
    return NextResponse.json({ ok: true, ...(await runContentPlanning()) });
  } catch (e) {
    logError('cron/plan-content', e);
    return NextResponse.json({ error: 'falha no planejamento' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
