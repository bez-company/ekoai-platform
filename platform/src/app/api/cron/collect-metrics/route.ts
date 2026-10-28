// Coleta das métricas do Instagram dos posts publicados (BEZ-183), disparada pelo Cloud Scheduler com
// token OIDC (ou por `Authorization: Bearer <CRON_SECRET>` à mão). Sem credencial válida, recusa: ver
// lib/cron-auth.ts. Também lê o público da conta (SPEC 022). A resposta traz só contagens, nunca token, conta ou post.

import { NextResponse } from 'next/server';
import { runAudienceCollection } from '@/lib/audience';
import { runCostAnomalyCheck } from '@/lib/cost-anomaly';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runMetricsCollection } from '@/lib/instagram-metrics';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: Request) {
  if (!(await isCronAuthorized(req))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const metrics = await runMetricsCollection();
    // O público muda devagar: uma leitura por dia e conta, mesmo com o cron rodando a cada 6 h.
    // Falha do público não derruba a coleta dos posts, que já foi gravada.
    const audience = await runAudienceCollection().catch((e) => {
      logError('cron/collect-metrics/audience', e);
      return null;
    });
    // Alerta de custo por post aprovado (BEZ-410): também não derruba a coleta.
    const cost = await runCostAnomalyCheck().catch((e) => {
      logError('cron/collect-metrics/cost-anomaly', e);
      return null;
    });
    return NextResponse.json({ ok: true, ...metrics, audience, cost });
  } catch (e) {
    logError('cron/collect-metrics', e);
    return NextResponse.json({ error: 'falha na coleta' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
