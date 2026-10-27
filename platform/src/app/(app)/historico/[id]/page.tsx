import Link from 'next/link';
import { notFound } from 'next/navigation';
import FeedFrame from '@/components/posts/FeedFrame';
import FeedbackForm from '@/components/FeedbackForm';
import RemovePublished from '@/components/published/RemovePublished';
import { accountOf } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { fmtDateTime } from '@/lib/format';
import { fmtCount, fmtRate, getPublished, type PublishedItem } from '@/lib/published-feed';
import { isUuid } from '@/lib/route-input';
import { can, pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <b className="block text-xl font-semibold">{value}</b>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function Metrics({ p }: { p: PublishedItem }) {
  if (!p.metrics) {
    return (
      <p className="text-sm text-muted">
        Os números aparecem depois da primeira leitura do Instagram, que acontece algumas horas depois de o post sair. Sem o Instagram conectado, a Ekoai não lê as métricas.
      </p>
    );
  }
  const m = p.metrics;
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Metric value={fmtCount(m.likes)} label="curtidas" />
        <Metric value={fmtCount(m.comments)} label="comentários" />
        <Metric value={fmtCount(m.saves)} label="salvamentos" />
        <Metric value={fmtCount(m.shares)} label="compartilhamentos" />
        <Metric value={fmtCount(m.reach)} label="contas alcançadas" />
        <Metric value={fmtRate(m.engagement)} label="engajamento" />
      </div>
      <p className="text-xs text-muted">Lido do Instagram em {fmtDateTime(m.capturedAt)}. Engajamento é curtidas, comentários, salvamentos e compartilhamentos sobre o alcance.</p>
    </>
  );
}

// Detalhe de um publicado (SPEC 017, decisão 14): o post como saiu no feed, os números do Instagram
// e o parecer da pessoa por aspecto, que vira regra no Aprendizado (SPEC 003).
export default async function PublishedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const t = await pageTenant();
  let p: PublishedItem | null = null;
  let handle = '';
  let accountName = '';
  let err = '';
  try {
    const [item, account, profile] = await Promise.all([getPublished(t, id), accountOf(t.tenantId), getProfile(t)]);
    p = item;
    accountName = account?.name ?? '';
    handle = profile?.instagramHandle ? `@${profile.instagramHandle}` : accountName;
  } catch (e) {
    err = pageError(e, 'page/history/[id]');
  }
  if (err) return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>;
  if (!p) notFound();
  const [canFeedback, canRemove] = await Promise.all([can('content.feedback'), can('content.approve')]);

  return (
    <div className="space-y-4">
      <Link href="/historico" className="text-sm text-muted hover:text-fg">
        ← Publicados
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{p.title}</h1>
        <p className="mt-1 text-sm text-muted">{p.publishedAt ? `Publicado ${fmtDateTime(p.publishedAt)}` : 'Publicado'} no Instagram</p>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <FeedFrame handle={handle} accountName={accountName} imageUrl={p.imageUrl} caption={p.caption} ratio="4:5" />

        <div className="space-y-4">
          <section className="card space-y-3">
            <h2 className="text-base font-semibold">Como foi</h2>
            <Metrics p={p} />
            {p.funnel && p.funnel.cadastros > 0 && (
              <p className="text-sm text-success">
                {p.funnel.cadastros} {p.funnel.cadastros === 1 ? 'cadastro' : 'cadastros'} · {p.funnel.ativados} {p.funnel.ativados === 1 ? 'ativado' : 'ativados'} · {p.funnel.pagantes}{' '}
                {p.funnel.pagantes === 1 ? 'pagante' : 'pagantes'} vieram deste post.
              </p>
            )}
          </section>

          {canRemove && (
            <section className="card flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm text-muted">Apagou o post no Instagram, ou não quer mais vê-lo aqui? Tire da lista. O post continua no Instagram até você apagá-lo lá.</p>
              <RemovePublished id={p.id} />
            </section>
          )}

          {canFeedback && (
            <section className="card space-y-3">
              <div>
                <h2 className="text-base font-semibold">O que achou deste post?</h2>
                <p className="text-sm text-muted">Escolha o aspecto e diga o que funcionou ou não. A Ekoai aprende com o seu parecer e com os números.</p>
              </div>
              <FeedbackForm channel={p.channel} postId={p.id} excerpt={p.title} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
