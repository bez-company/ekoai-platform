import Link from 'next/link';
import { pageError } from '@/lib/api';
import PricingForm from '@/components/console/PricingForm';
import { financeAccounts, getPricing } from '@/lib/console-finance';
import { isBelowTarget, isPricingSet, profitOf } from '@/lib/price-model';
import { fmtBrl, fmtUsd } from '@/lib/console-finance-model';
import { FX_REVIEWED_AT, FX_USD_BRL, fxIsStale, toBrl } from '@/lib/pricing';
import { pageConsole } from '@/lib/platform-admin';
import { monthLabel, parseMonth, recentMonths, monthKeyOf } from '@/lib/usage-model';

export const dynamic = 'force-dynamic';

// Console › Financeiro (SPEC 031, entrega 3): o custo real do mês por conta. Só a administradora da plataforma. O custo é em dólar (como a
// Vertex e a API do X cobram) e em reais pela cotação datada de pricing.json. Sem "cobrado" nem margem: a cobrança real é do BEZ-301.
export default async function ConsoleFinance({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await pageConsole();
  const now = new Date();
  const month = parseMonth((await searchParams).mes, now);
  const rate = FX_USD_BRL.toFixed(2).replace('.', ',');
  const head = (
    <div>
      <h1 className="text-2xl font-semibold">Financeiro</h1>
      <p className="text-sm text-muted">
        {monthLabel(month)} · US$ 1 = R$ {rate} (cotação de {new Date(FX_REVIEWED_AT).toLocaleDateString('pt-BR', { timeZone: 'UTC' })})
      </p>
    </div>
  );
  const nav = (
    <nav aria-label="Mês" className="flex flex-wrap gap-2">
      {recentMonths(now).map((m) => (
        <Link key={m} href={m === monthKeyOf(now) ? '/console/financeiro' : `/console/financeiro?mes=${m}`} aria-current={m === month ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-sm ${m === month ? 'border-fg bg-fg text-page' : 'border-line hover:border-line-strong'}`}>
          {monthLabel(m)}
        </Link>
      ))}
    </nav>
  );

  let accounts;
  let pricing;
  try {
    pricing = await getPricing();
    accounts = await financeAccounts(month, pricing);
  } catch (e) {
    return (
      <div className="space-y-4">
        {head}
        {nav}
        <p role="alert" className="card border-danger/30 bg-danger/10 text-sm">
          <strong>Não conseguimos carregar o custo do mês.</strong> {pageError(e, 'page/console/financeiro')}
        </p>
      </div>
    );
  }
  const cost = accounts.reduce((n, a) => n + a.costUsd, 0);
  const posts = accounts.reduce((n, a) => n + a.posts, 0);
  const postsCost = accounts.reduce((n, a) => n + a.postsCostUsd, 0);
  const noRevenue = accounts.reduce((n, a) => n + a.noRevenueCostUsd, 0);
  const priced = isPricingSet(pricing);
  const price = accounts.reduce((n, a) => n + (a.priceBrl ?? 0), 0);
  const overall = profitOf(price, toBrl(postsCost));
  const low = priced && isBelowTarget(overall.marginPercent, pricing);
  const href = (id: string) => `/console/financeiro/${id}${month === monthKeyOf(now) ? '' : `?mes=${month}`}`;

  return (
    <div className="space-y-4">
      {head}
      {fxIsStale() && (
        <p role="status" className="card border-warning/30 bg-warning/10 text-sm">
          <strong>A cotação do dólar está velha.</strong> Atualize `usd_brl` e `reviewed_at` em pricing.json: o valor em reais abaixo pode estar errado.
        </p>
      )}
      <p role="status" className="card border-info/30 bg-info/10 text-sm">
        <strong>A cobrança ainda não começou.</strong> A cobrança prevista abaixo é o que seria cobrado com o preço atual, para você ver o lucro antes de cobrar de verdade.
      </p>
      {!isPricingSet(pricing) && (
        <p role="status" className="card border-warning/30 bg-warning/10 text-sm">
          <strong>O preço ainda não foi definido.</strong> Defina o percentual sobre o custo e o preço mínimo em “Preço e margem”, no fim da página, para ver a cobrança prevista e o lucro.
        </p>
      )}
      {nav}
      {accounts.length === 0 ? (
        <div className="card text-center">
          <h2 className="text-base font-semibold">Nenhum uso neste mês</h2>
          <p className="text-sm text-muted">O custo aparece aqui quando alguma conta gerar ou publicar um post.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <div className="card space-y-1 p-4">
              <p className="text-xs text-muted">Custo do mês</p>
              <p className="text-2xl font-bold">{fmtUsd(cost)}</p>
              <p className="text-xs text-muted">{fmtBrl(toBrl(cost))}</p>
            </div>
            <div className="card space-y-1 p-4">
              <p className="text-xs text-muted">Posts</p>
              <p className="text-2xl font-bold">{posts}</p>
              <p className="text-xs text-muted">custo médio {posts ? fmtUsd(postsCost / posts) : '-'}</p>
            </div>
            <div className="card space-y-1 p-4">
              <p className="text-xs text-muted">Cobrança prevista</p>
              <p className="text-2xl font-bold">{priced ? fmtBrl(price) : '-'}</p>
              <p className="text-xs text-muted">{priced ? 'dos posts do mês' : 'defina o preço'}</p>
            </div>
            <div className="card space-y-1 p-4">
              <p className="text-xs text-muted">Lucro bruto</p>
              <p className="text-2xl font-bold">{priced ? fmtBrl(overall.profitBrl) : '-'}</p>
              <p className={`text-xs ${low ? 'text-warning' : 'text-muted'}`}>{priced ? `margem ${overall.marginPercent.toFixed(0)}%${low ? ' (abaixo da meta)' : ''}` : ''}</p>
            </div>
            <div className="card space-y-1 p-4">
              <p className="text-xs text-muted">Custo sem receita</p>
              <p className="text-2xl font-bold">{fmtUsd(noRevenue)}</p>
              <p className="text-xs text-muted">pedidos que não viraram post</p>
            </div>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Plano</th>
                  <th className="px-4 py-3 text-right">Posts</th>
                  <th className="px-4 py-3 text-right">Custo (US$)</th>
                  <th className="px-4 py-3 text-right">Custo (R$)</th>
                  <th className="px-4 py-3 text-right">Cobrança prevista</th>
                  <th className="px-4 py-3 text-right">Lucro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-inset">
                    <td className="px-4 py-3">
                      <Link href={href(a.id)} className="font-semibold underline-offset-2 hover:underline">
                        {a.name}
                      </Link>
                      {a.discountPercent !== null && <span className="ml-2 rounded-full bg-inset px-2 py-0.5 text-xs text-muted">desconto {String(a.discountPercent).replace('.', ',')}%</span>}
                    </td>
                    <td className="px-4 py-3">{a.planId ?? '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.posts}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(a.costUsd)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtBrl(toBrl(a.costUsd))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.priceBrl === null ? '-' : fmtBrl(a.priceBrl)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.priceBrl === null ? '-' : fmtBrl(profitOf(a.priceBrl, toBrl(a.postsCostUsd)).profitBrl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <PricingForm initial={pricing} />
    </div>
  );
}
