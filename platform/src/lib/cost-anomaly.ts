// cost-anomaly.ts: alerta de custo por post aprovado (BEZ-410, sobra do BEZ-167). Custo do post = soma de
// todas as chamadas de modelo do pedido em `generation_runs`, com regeneração e falha (o mesmo número do
// `post_ready`). Post aprovado = pedido com linha em `scheduled_posts`. A mediana é a de todas as contas na
// janela, porque o que se vigia é o custo da plataforma, não o de uma conta.
//
// Roda dentro do cron collect-metrics (a cada 6 h): olha os posts aprovados nas últimas 6 h contra a mediana
// dos aprovados antes disso. Só alerta com amostra mínima, senão os primeiros posts da plataforma disparam
// sempre. O alerta é uma linha de log de severidade WARNING (escopo `cost-anomaly`); a política de
// monitoramento do Terraform manda para o e-mail da equipe.

import { db } from './db';
import { log } from './log';

export const ANOMALY_FACTOR = 2;
export const WINDOW_DAYS = 30;
export const MIN_BASELINE_POSTS = 10;
export const RECENT_HOURS = 6;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type ApprovedPostCost = { briefId: string; tenantId: string; costUsd: number; approvedAt: string };

export type CostAnomalies = { median: number | null; baselineSize: number; recentSize: number; anomalies: ApprovedPostCost[] };

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Puro. A linha de base são os aprovados na janela e antes das últimas RECENT_HOURS; os recentes são o que
// se compara. Mediana zero (custo ainda não medido) não dá base: nada é "o dobro de zero".
export function detectCostAnomalies(posts: readonly ApprovedPostCost[], nowMs: number): CostAnomalies {
  const recentFrom = nowMs - RECENT_HOURS * HOUR;
  const windowFrom = nowMs - WINDOW_DAYS * DAY;
  const baseline: number[] = [];
  const recent: ApprovedPostCost[] = [];
  for (const p of posts) {
    const at = Date.parse(p.approvedAt);
    if (!Number.isFinite(at) || !Number.isFinite(p.costUsd) || at < windowFrom || at > nowMs) continue;
    if (at > recentFrom) recent.push(p);
    else baseline.push(p.costUsd);
  }
  const base = median(baseline);
  if (base === null || base <= 0 || baseline.length < MIN_BASELINE_POSTS) return { median: base, baselineSize: baseline.length, recentSize: recent.length, anomalies: [] };
  return { median: base, baselineSize: baseline.length, recentSize: recent.length, anomalies: recent.filter((p) => p.costUsd > base * ANOMALY_FACTOR) };
}

export async function runCostAnomalyCheck(nowMs = Date.now()): Promise<{ checked: number; anomalies: number }> {
  const res = await db().query(
    `with approved as (
       select brief_id, min(created_at) as approved_at from scheduled_posts
       where brief_id is not null and created_at >= now() - make_interval(days => $1) group by brief_id
     )
     select a.brief_id, r.tenant_id, a.approved_at, coalesce(sum(r.cost_usd), 0)::float8 as cost_usd
     from approved a join generation_runs r on r.brief_id = a.brief_id
     group by a.brief_id, r.tenant_id, a.approved_at`,
    [WINDOW_DAYS],
  );
  const posts: ApprovedPostCost[] = res.rows.map((r) => ({ briefId: String(r.brief_id), tenantId: String(r.tenant_id), costUsd: Number(r.cost_usd), approvedAt: new Date(r.approved_at as string).toISOString() }));
  const { median: base, anomalies, recentSize } = detectCostAnomalies(posts, nowMs);
  for (const a of anomalies) {
    log('warn', 'cost-anomaly', `custo por post aprovado acima de ${ANOMALY_FACTOR}x a mediana`, {
      brief_id: a.briefId,
      tenant_id: a.tenantId,
      cost_usd: Math.round(a.costUsd * 1e6) / 1e6,
      median_usd: Math.round((base ?? 0) * 1e6) / 1e6,
      factor: base ? Math.round((a.costUsd / base) * 10) / 10 : null,
    });
  }
  return { checked: recentSize, anomalies: anomalies.length };
}
