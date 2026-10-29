import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageError } from '@/lib/api';
import DiscountForm from '@/components/console/DiscountForm';
import { financePosts, getPricing } from '@/lib/console-finance';
import { listDiscounts } from '@/lib/console-discounts';
import { dayOf, discountOn, isPricingSet, postPriceWithDiscountBrl, profitOf } from '@/lib/price-model';
import { GROUPS, costByGroup, fmtBrl, fmtUsd, totalCost } from '@/lib/console-finance-model';
import { pageConsole } from '@/lib/platform-admin';
import { fxForMonth } from '@/lib/fx-rates';
import { toBrl } from '@/lib/pricing';
import { isTenantId } from '@/lib/tenant';
import { monthKeyOf, monthLabel, parseMonth } from '@/lib/usage-model';

export const dynamic = 'force-dynamic';

// Console › Financeiro › uma conta: os posts do mês com o custo de cada um por grupo de etapa (SPEC 031, entrega 3).
export default async function ConsoleFinanceAccount({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ mes?: string }> }) {
  await pageConsole();
  const { tenant } = await params;
  if (!isTenantId(tenant)) notFound();
  const now = new Date();
  const month = parseMonth((await searchParams).mes, now);
  const suffix = month === monthKeyOf(now) ? '' : `?mes=${month}`;

  let data;
  let pricing;
  let discounts;
  let fx;
  try {
    [data, pricing, discounts, fx] = await Promise.all([financePosts(tenant, month), getPricing(), listDiscounts(tenant), fxForMonth(month)]);
  } catch (e) {
    return (
      <p role="alert" className="card border-danger/30 bg-danger/10 text-sm">
        <strong>Não conseguimos carregar os posts da conta.</strong> {pageError(e, 'page/console/financeiro/conta')}
      </p>
    );
  }
  if (!data) notFound();
  const all = data.posts.flatMap((p) => p.runs);
  const total = totalCost(all);
  const priced = isPricingSet(pricing);
  // O desconto que valia no dia em que cada post foi criado (SPEC 032): mudar o desconto depois não reescreve o preço de um período anterior.
  const priceOf = (p: { costUsd: number; createdAt: string }) => postPriceWithDiscountBrl(toBrl(p.costUsd, fx.usdBrl), pricing, discountOn(discounts, p.createdAt.slice(0, 10))?.discountPercent ?? 0);
  const priceTotal = data.posts.reduce((n, p) => n + priceOf(p), 0);
  const today = dayOf(now);
  const active = discountOn(discounts, today);
  const overall = profitOf(priceTotal, toBrl(total, fx.usdBrl));

  return (
    <div className="space-y-4">
      <Link href={`/console/financeiro${suffix}`} className="text-sm text-muted hover:text-fg">
        ← Financeiro
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <p className="text-sm text-muted">
          {monthLabel(month)} · {data.total} {data.total === 1 ? 'post' : 'posts'} · custo {fmtUsd(total)} ({fmtBrl(toBrl(total, fx.usdBrl))}){priced ? ` · cobrança prevista ${fmtBrl(priceTotal)} · lucro ${fmtBrl(overall.profitBrl)} (${overall.marginPercent.toFixed(0)}%)` : ''} nos {data.posts.length} mais novos
        </p>
      </div>
      <DiscountForm accountId={tenant} pricing={pricing} active={active} history={discounts} today={today} />
      {data.posts.length === 0 ? (
        <div className="card text-center text-sm text-muted">Nenhum post neste mês.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">Post</th>
                {GROUPS.map((g) => (
                  <th key={g.id} className="px-3 py-3 text-right">
                    {g.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right">Custo</th>
                {priced && <th className="px-4 py-3 text-right">Cobrança prevista</th>}
                {priced && <th className="px-4 py-3 text-right">Lucro</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.posts.map((p) => {
                const by = costByGroup(p.runs);
                return (
                  <tr key={p.id} className="hover:bg-inset">
                    <td className="px-4 py-3">
                      <Link href={`/console/financeiro/${tenant}/${p.id}${suffix}`} className="font-semibold underline-offset-2 hover:underline">
                        {p.title}
                      </Link>
                      <span className="block text-xs text-muted">{new Date(p.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })}</span>
                    </td>
                    {GROUPS.map((g) => (
                      <td key={g.id} className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {by[g.id] ? fmtUsd(by[g.id]) : '-'}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{fmtUsd(p.costUsd)}</td>
                    {priced && <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtBrl(priceOf(p))}</td>}
                    {priced && <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtBrl(profitOf(priceOf(p), toBrl(p.costUsd, fx.usdBrl)).profitBrl)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.total > data.posts.length && <p className="text-xs text-muted">Mostrando os {data.posts.length} mais novos dos {data.total} posts do mês.</p>}
    </div>
  );
}
