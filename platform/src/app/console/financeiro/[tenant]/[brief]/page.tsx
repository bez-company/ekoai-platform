import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageError } from '@/lib/api';
import { financePost } from '@/lib/console-finance';
import { GROUPS, costByChannel, costByGroup, fmtBrl, fmtUsd, percent, totalCost } from '@/lib/console-finance-model';
import { pageConsole } from '@/lib/platform-admin';
import { toBrl } from '@/lib/pricing';
import { isUuid } from '@/lib/route-input';
import { isTenantId } from '@/lib/tenant';
import { CHANNEL_LABEL } from '@/lib/usage-posts-model';
import { monthKeyOf, parseMonth } from '@/lib/usage-model';

export const dynamic = 'force-dynamic';

const COLORS = ['bg-accent', 'bg-info', 'bg-warning', 'bg-success', 'bg-danger'];

// Console › Financeiro › um post: o custo de cada chamada, por grupo e por rede (SPEC 031, entrega 3).
export default async function ConsoleFinancePost({ params, searchParams }: { params: Promise<{ tenant: string; brief: string }>; searchParams: Promise<{ mes?: string }> }) {
  await pageConsole();
  const { tenant, brief } = await params;
  if (!isTenantId(tenant) || !isUuid(brief)) notFound();
  const month = parseMonth((await searchParams).mes, new Date());
  const suffix = month === monthKeyOf(new Date()) ? '' : `?mes=${month}`;

  let post;
  try {
    post = await financePost(tenant, brief);
  } catch (e) {
    return (
      <p role="alert" className="card border-danger/30 bg-danger/10 text-sm">
        <strong>Não conseguimos carregar o custo do post.</strong> {pageError(e, 'page/console/financeiro/post')}
      </p>
    );
  }
  if (!post) notFound();
  const total = totalCost(post.runs);
  const byGroup = costByGroup(post.runs);
  const byChannel = costByChannel(post.runs);

  return (
    <div className="space-y-4">
      <Link href={`/console/financeiro/${tenant}${suffix}`} className="text-sm text-muted hover:text-fg">
        ← {post.account}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{post.title}</h1>
        <p className="text-sm text-muted">
          {new Date(post.createdAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · custo {fmtUsd(total)} ({fmtBrl(toBrl(total))})
        </p>
      </div>

      <section className="card space-y-2" aria-label="Custo por grupo">
        <h2 className="text-base font-semibold">Custo por grupo</h2>
        <div className="flex h-3.5 overflow-hidden rounded-full bg-inset" role="img" aria-label="Divisão do custo do post por grupo">
          {GROUPS.map((g, i) => (byGroup[g.id] > 0 ? <i key={g.id} className={COLORS[i % COLORS.length]} style={{ width: `${percent(byGroup[g.id], total)}%` }} title={g.label} /> : null))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {GROUPS.map((g) => (
            <li key={g.id} className="flex items-center gap-1.5">
              <i className={`inline-block h-2.5 w-2.5 rounded-sm ${COLORS[GROUPS.indexOf(g) % COLORS.length]}`} aria-hidden="true" />
              {g.label} {fmtUsd(byGroup[g.id])}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Por rede: {(['instagram', 'linkedin', 'twitter'] as const).map((c) => `${CHANNEL_LABEL[c]} ${fmtUsd(byChannel[c])}`).join(', ')}; sem rede (ler o pedido, núcleo) {fmtUsd(byChannel.shared)}.
        </p>
      </section>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3">Etapa</th>
              <th className="px-3 py-3">Rede</th>
              <th className="px-3 py-3">Estado</th>
              <th className="px-3 py-3">Modelo</th>
              <th className="px-3 py-3 text-right">Tokens (entrada, saída)</th>
              <th className="px-4 py-3 text-right">Custo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {post.runs.map((r, i) => (
              <tr key={`${r.createdAt}-${i}`}>
                <td className="px-4 py-3">
                  <code>{r.step}</code>
                </td>
                <td className="px-3 py-3">{r.channel ? CHANNEL_LABEL[r.channel as keyof typeof CHANNEL_LABEL] ?? r.channel : 'todas'}</td>
                <td className="px-3 py-3">{r.status === 'done' ? 'feita' : r.status === 'failed' ? 'falhou' : 'reservada'}</td>
                <td className="px-3 py-3 text-muted">{r.model ?? '-'}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {r.inputTokens} / {r.outputTokens}
                  {r.images ? ` · ${r.images} ${r.images === 1 ? 'imagem' : 'imagens'}` : ''}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-4 py-3" colSpan={5}>
                Total do post
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
