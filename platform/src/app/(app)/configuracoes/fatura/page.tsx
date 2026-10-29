import Link from 'next/link';
import { pageError } from '@/lib/api';
import { pageContext } from '@/lib/session';
import { monthUsage } from '@/lib/usage';
import { monthPosts } from '@/lib/usage-posts';
import { CHANNEL_LABEL, POST_STATE_LABEL, POSTS_PER_PAGE } from '@/lib/usage-posts-model';
import { MONTHS_SHOWN, isEmptyUsage, monthKeyOf, monthLabel, parseMonth, recentMonths, totalPublications } from '@/lib/usage-model';

export const dynamic = 'force-dynamic';

const NAME = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' } as const;

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card space-y-1 p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

// Configurações › Fatura e uso (SPEC 031, entrega 1): o que a conta usou no mês. Só quem administra a conta (billing.manage); os outros
// papéis recebem 404. Antes da cobrança real não há preço, então a tela não mostra valor em reais.
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { t } = await pageContext('billing.manage');
  const now = new Date();
  const month = parseMonth((await searchParams).mes, now);
  const months = recentMonths(now);
  const nav = (
    <nav aria-label="Mês" className="flex flex-wrap gap-2">
      {months.map((m) => (
        <Link
          key={m}
          href={m === monthKeyOf(now) ? '/configuracoes/fatura' : `/configuracoes/fatura?mes=${m}`}
          aria-current={m === month ? 'page' : undefined}
          className={`rounded-full border px-3 py-1 text-sm transition ${m === month ? 'border-fg bg-fg text-page' : 'border-line hover:border-line-strong'}`}
        >
          {monthLabel(m)}
        </Link>
      ))}
    </nav>
  );
  const head = (
    <div>
      <h2 className="text-lg font-semibold">Fatura e uso</h2>
      <p className="text-sm text-muted">O que a conta usou em {monthLabel(month).toLowerCase()}. O histórico guarda os últimos {MONTHS_SHOWN} meses.</p>
    </div>
  );

  try {
    const [usage, posts] = await Promise.all([monthUsage(t, month, now), monthPosts(t, month)]);
    return (
      <div className="space-y-4">
        {head}
        <p role="status" className="card border-info/30 bg-info/10 text-sm">
          <strong>A cobrança ainda não começou.</strong> Nada é cobrado por enquanto. Aqui você vê o que a conta usou, para saber o que vai entrar na fatura.
        </p>
        {nav}
        {isEmptyUsage(usage) ? (
          <div className="card space-y-2 text-center">
            <h3 className="text-base font-semibold">Nenhum uso neste mês</h3>
            <p className="text-sm text-muted">{usage.isCurrent ? 'O uso aparece aqui quando a conta criar o primeiro post do mês.' : 'A conta não criou nem publicou posts neste mês.'}</p>
            {usage.isCurrent && (
              <Link href="/criar" className="btn-primary mx-auto">
                Criar post
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <Stat label="Posts do mês" value={usage.posts} hint="uma ideia, um post" />
              <Stat label="Publicações" value={totalPublications(usage)} hint={(['instagram', 'linkedin', 'twitter'] as const).map((c) => `${NAME[c]} ${usage.publications[c]}`).join(', ')} />
              <Stat label="Imagens geradas" value={usage.images} hint="o carrossel do layout da marca não conta" />
              <Stat label="Ajustes" value={usage.adjustments} hint="não contam como post" />
              {usage.people !== null && <Stat label="Pessoas" value={usage.people} hint="com acesso à conta" />}
            </div>
            <section aria-label="Posts do mês" className="card space-y-1 p-0">
              <h3 className="px-4 pt-4 text-base font-semibold">Posts de {monthLabel(month).toLowerCase()}</h3>
              <ul className="divide-y divide-line">
                {posts.rows.map((p) => (
                  <li key={p.id}>
                    <Link href={`/configuracoes/fatura/post/${p.id}${month === monthKeyOf(now) ? '' : `?mes=${month}`}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-inset">
                      <span className="min-w-0 basis-full md:basis-auto md:flex-1">
                        <strong className="block text-sm md:truncate">{p.title}</strong>
                        <span className="text-xs text-muted">{new Date(p.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })}</span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {p.channels.map((c) => (
                          <span key={c} className="chip">
                            {CHANNEL_LABEL[c]}
                          </span>
                        ))}
                      </span>
                      <span className="ml-auto text-sm text-muted md:w-28 md:text-right">{POST_STATE_LABEL[p.state]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="px-4 pb-4 pt-2 text-xs text-muted">
                {posts.total > posts.rows.length ? `Mostrando ${posts.rows.length} dos ${posts.total} posts do mês. ` : ''}Cada ideia é um post, em qualquer número de redes.
              </p>
            </section>
            <p className="text-xs text-muted">Um post é uma ideia, em qualquer número de redes. Ajustes, novas tentativas de uma rede e avaliações não contam como post novo. O mês é o de UTC, o mesmo recorte do limite do plano.</p>
          </>
        )}
      </div>
    );
  } catch (e) {
    return (
      <div className="space-y-4">
        {head}
        {nav}
        <div role="alert" className="card space-y-2 border-danger/30 bg-danger/10 text-sm">
          <p>
            <strong>Não conseguimos carregar o uso do mês.</strong> Nada mudou na sua conta. {pageError(e, 'page/configuracoes/fatura')}
          </p>
          <Link href={month === monthKeyOf(now) ? '/configuracoes/fatura' : `/configuracoes/fatura?mes=${month}`} className="btn-ghost w-fit">
            Tentar de novo
          </Link>
        </div>
      </div>
    );
  }
}
