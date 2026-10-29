// console-finance.ts: o custo real por conta, por post e por chamada, lido do banco para o Console › Financeiro (SPEC 031, entrega 3).
// Uso de sistema: atravessa as contas de propósito (só a administradora da plataforma chega aqui, pelo portão do console), por isso usa db()
// direto, como console-accounts.ts e cost-anomaly.ts. O custo é a soma de `cost_usd` de todas as chamadas do pedido, com regeneração e falha.

import { db } from './db';
import { monthRange, type MonthKey } from './usage-model';
import { stepRank, toRunCost, totalCost, type RunCost } from './console-finance-model';
import { postTitle } from './usage-posts-model';
import { recordAudit } from './audit';
import { EMPTY_PRICING, isPricingSet, postPriceBrl, type PricingConfig } from './price-model';
import { FX_USD_BRL, toBrl } from './pricing';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// A política de preço (a margem): só o console lê e grava, e nunca vai para o repositório nem para uma tela de cliente.
export async function getPricing(): Promise<PricingConfig> {
  const res = await db().query('select markup_percent, minimum_per_post_brl, round_up_to_brl, target_margin_percent from platform_pricing where singleton');
  const r = res.rows[0] as Record<string, unknown> | undefined;
  if (!r) return EMPTY_PRICING;
  return { markupPercent: num(r.markup_percent), minimumPerPostBrl: num(r.minimum_per_post_brl), roundUpToBrl: num(r.round_up_to_brl), targetMarginPercent: num(r.target_margin_percent) };
}

export async function savePricing(config: PricingConfig, actorId: string): Promise<void> {
  await db().query(
    `insert into platform_pricing (singleton, markup_percent, minimum_per_post_brl, round_up_to_brl, target_margin_percent, updated_by)
     values (true, $1, $2, $3, $4, $5)
     on conflict (singleton) do update set markup_percent = $1, minimum_per_post_brl = $2, round_up_to_brl = $3, target_margin_percent = $4, updated_at = now(), updated_by = $5`,
    [config.markupPercent, config.minimumPerPostBrl, config.roundUpToBrl, config.targetMarginPercent, actorId],
  );
  // Só o fato de ter mudado vai para a auditoria: os valores são o segredo do negócio.
  await recordAudit((text, params) => db().query(text, params), { tenantId: null, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.pricing_changed', targetType: 'platform_pricing' });
}

export type FinanceAccount = {
  id: string;
  name: string;
  kind: string;
  planId: string | null;
  posts: number;
  runs: number;
  costUsd: number; // todo o custo das chamadas do mês, com ou sem post
  postsCostUsd: number; // o custo dos posts do mês (a parte que gera receita)
  noRevenueCostUsd: number; // chamadas do mês de pedidos que não viraram post (falhou, está na fila): custo sem receita
  priceBrl: number | null; // a cobrança prevista dos posts do mês; null com o preço indefinido
};

// O custo do mês de cada conta que teve uso, da mais cara para a mais barata, com a cobrança prevista quando o preço está definido.
export async function financeAccounts(month: MonthKey, pricing?: PricingConfig): Promise<FinanceAccount[]> {
  const { start, end } = monthRange(month);
  const config = pricing ?? (await getPricing());
  const [accounts, postCosts] = await Promise.all([
    db().query(
      `select t.id, t.name, t.kind, t.plan_id,
              coalesce(r.cost, 0) as cost, coalesce(r.runs, 0) as runs, coalesce(b.posts, 0) as posts, coalesce(n.cost, 0) as no_revenue
         from tenants t
         left join (select tenant_id, sum(cost_usd) as cost, count(*) as runs from generation_runs
                     where created_at >= $1 and created_at < $2 group by tenant_id) r on r.tenant_id = t.id
         left join (select tenant_id, count(*) as posts from briefs
                     where status in ('ready', 'approved') and created_at >= $1 and created_at < $2 group by tenant_id) b on b.tenant_id = t.id
         left join (select g.tenant_id, sum(g.cost_usd) as cost from generation_runs g
                     where g.created_at >= $1 and g.created_at < $2
                       and not exists (select 1 from briefs x where x.id = g.brief_id and x.status in ('ready', 'approved'))
                     group by g.tenant_id) n on n.tenant_id = t.id
        where r.tenant_id is not null or b.tenant_id is not null
        order by cost desc, t.name`,
      [start, end],
    ),
    // O custo de cada post do mês (todas as chamadas do pedido): o preço é por post, com mínimo, então precisa do custo de cada um.
    db().query(
      `select b.tenant_id, b.id, coalesce(sum(r.cost_usd), 0) as cost
         from briefs b left join generation_runs r on r.brief_id = b.id and r.tenant_id = b.tenant_id
        where b.status in ('ready', 'approved') and b.created_at >= $1 and b.created_at < $2
        group by b.tenant_id, b.id`,
      [start, end],
    ),
  ]);
  const byTenant = new Map<string, { cost: number; price: number }>();
  for (const row of postCosts.rows as Record<string, unknown>[]) {
    const cost = num(row.cost);
    const entry = byTenant.get(String(row.tenant_id)) ?? { cost: 0, price: 0 };
    entry.cost += cost;
    entry.price += postPriceBrl(toBrl(cost, FX_USD_BRL), config);
    byTenant.set(String(row.tenant_id), entry);
  }
  const priced = isPricingSet(config);
  return (accounts.rows as Record<string, unknown>[]).map((r) => {
    const mine = byTenant.get(String(r.id));
    return {
      id: String(r.id),
      name: String(r.name ?? r.id),
      kind: String(r.kind ?? ''),
      planId: r.plan_id ? String(r.plan_id) : null,
      posts: num(r.posts),
      runs: num(r.runs),
      costUsd: num(r.cost),
      postsCostUsd: mine?.cost ?? 0,
      noRevenueCostUsd: num(r.no_revenue),
      priceBrl: priced ? (mine?.price ?? 0) : null,
    };
  });
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
