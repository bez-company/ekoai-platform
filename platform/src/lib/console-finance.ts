// console-finance.ts: o custo real por conta, por post e por chamada, lido do banco para o Console › Financeiro (SPEC 031, entrega 3).
// Uso de sistema: atravessa as contas de propósito (só a administradora da plataforma chega aqui, pelo portão do console), por isso usa db()
// direto, como console-accounts.ts e cost-anomaly.ts. O custo é a soma de `cost_usd` de todas as chamadas do pedido, com regeneração e falha.

import { db } from './db';
import { monthRange, type MonthKey } from './usage-model';
import { stepRank, toRunCost, totalCost, type RunCost } from './console-finance-model';
import { postTitle } from './usage-posts-model';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type FinanceAccount = { id: string; name: string; kind: string; planId: string | null; posts: number; runs: number; costUsd: number };

// O custo do mês de cada conta que teve uso, da mais cara para a mais barata.
export async function financeAccounts(month: MonthKey): Promise<FinanceAccount[]> {
  const { start, end } = monthRange(month);
  const res = await db().query(
    `select t.id, t.name, t.kind, t.plan_id,
            coalesce(r.cost, 0) as cost, coalesce(r.runs, 0) as runs, coalesce(b.posts, 0) as posts
       from tenants t
       left join (select tenant_id, sum(cost_usd) as cost, count(*) as runs from generation_runs
                   where created_at >= $1 and created_at < $2 group by tenant_id) r on r.tenant_id = t.id
       left join (select tenant_id, count(*) as posts from briefs
                   where status in ('ready', 'approved') and created_at >= $1 and created_at < $2 group by tenant_id) b on b.tenant_id = t.id
      where r.tenant_id is not null or b.tenant_id is not null
      order by cost desc, t.name`,
    [start, end],
  );
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    kind: String(r.kind ?? ''),
    planId: r.plan_id ? String(r.plan_id) : null,
    posts: num(r.posts),
    runs: num(r.runs),
    costUsd: num(r.cost),
  }));
}

export type FinancePost = { id: string; title: string; createdAt: string; runs: RunCost[]; costUsd: number };

// Os posts do mês de uma conta, com as chamadas de cada um. `null` se a conta não existe.
export async function financePosts(tenantId: string, month: MonthKey, limit = 50): Promise<{ name: string; total: number; posts: FinancePost[] } | null> {
  const { start, end } = monthRange(month);
  const tenant = await db().query('select id, name from tenants where id = $1', [tenantId]);
  if (!tenant.rows[0]) return null;
  const [count, briefs] = await Promise.all([
    db().query("select count(*)::int as n from briefs where tenant_id = $1 and status in ('ready', 'approved') and created_at >= $2 and created_at < $3", [tenantId, start, end]),
    db().query("select id, idea, created_at from briefs where tenant_id = $1 and status in ('ready', 'approved') and created_at >= $2 and created_at < $3 order by created_at desc limit $4", [tenantId, start, end, limit]),
  ]);
  const ids = (briefs.rows as { id: string }[]).map((b) => String(b.id));
  const runs = ids.length ? await db().query('select brief_id, step, channel, cost_usd from generation_runs where tenant_id = $1 and brief_id = any($2::uuid[])', [tenantId, ids]) : { rows: [] };
  const byBrief = new Map<string, RunCost[]>();
  for (const r of runs.rows as Record<string, unknown>[]) {
    const list = byBrief.get(String(r.brief_id)) ?? [];
    list.push(toRunCost(r as { step: unknown; channel?: unknown; cost_usd?: unknown }));
    byBrief.set(String(r.brief_id), list);
  }
  return {
    name: String(tenant.rows[0].name ?? tenantId),
    total: num(count.rows[0]?.n),
    posts: (briefs.rows as Record<string, unknown>[]).map((b) => {
      const list = byBrief.get(String(b.id)) ?? [];
      return { id: String(b.id), title: postTitle(String(b.idea ?? '')), createdAt: iso(b.created_at), runs: list, costUsd: totalCost(list) };
    }),
  };
}

export type FinanceRun = RunCost & { status: string; model: string | null; inputTokens: number; outputTokens: number; images: number; createdAt: string };

// Todas as chamadas de um post, na ordem em que aconteceram. `null` se o post não é desta conta.
export async function financePost(tenantId: string, briefId: string): Promise<{ account: string; title: string; createdAt: string; runs: FinanceRun[] } | null> {
  const brief = await db().query('select b.id, b.idea, b.created_at, t.name from briefs b join tenants t on t.id = b.tenant_id where b.id = $1 and b.tenant_id = $2', [briefId, tenantId]);
  const b = brief.rows[0] as Record<string, unknown> | undefined;
  if (!b) return null;
  const runs = await db().query('select step, channel, status, model, input_tokens, output_tokens, images, cost_usd, created_at from generation_runs where tenant_id = $1 and brief_id = $2 order by created_at', [tenantId, briefId]);
  return {
    account: String(b.name ?? tenantId),
    title: postTitle(String(b.idea ?? '')),
    createdAt: iso(b.created_at),
    runs: (runs.rows as Record<string, unknown>[]).map((r) => ({
      ...toRunCost(r as { step: unknown; channel?: unknown; cost_usd?: unknown }),
      status: String(r.status ?? ''),
      model: r.model ? String(r.model) : null,
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      images: num(r.images),
      createdAt: iso(r.created_at),
    })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || stepRank(a.step) - stepRank(b.step)),
  };
}
