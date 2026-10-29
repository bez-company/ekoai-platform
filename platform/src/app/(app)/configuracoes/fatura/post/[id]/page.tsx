import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageError } from '@/lib/api';
import { isUuid } from '@/lib/route-input';
import { pageContext } from '@/lib/session';
import { parseMonth, monthKeyOf } from '@/lib/usage-model';
import { postActivity } from '@/lib/usage-posts';
import { CHANNEL_LABEL, POST_STATE_LABEL, activityLines } from '@/lib/usage-posts-model';

export const dynamic = 'force-dynamic';

// Configurações › Fatura e uso › um post (SPEC 031, entrega 2): o que a Ekoai fez neste post e os ajustes, sem valores. Só quem administra a
// conta (billing.manage); post de outra conta ou pedido que ainda não é post é 404.
export default async function BillingPostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { t } = await pageContext('billing.manage');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const now = new Date();
  const month = parseMonth((await searchParams).mes, now);
  const back = month === monthKeyOf(now) ? '/configuracoes/fatura' : `/configuracoes/fatura?mes=${month}`;

  let post;
  try {
    post = await postActivity(t, id);
  } catch (e) {
    return (
      <div className="space-y-4">
        <Link href={back} className="text-sm text-muted hover:text-fg">
          ← Fatura e uso
        </Link>
        <p role="alert" className="card border-danger/30 bg-danger/10 text-sm">
          <strong>Não conseguimos carregar este post.</strong> Nada mudou na sua conta. {pageError(e, 'page/configuracoes/fatura/post')}
        </p>
      </div>
    );
  }
  if (!post) notFound();

  const lines = activityLines(post);
  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm text-muted hover:text-fg">
        ← Fatura e uso
      </Link>
      <div>
        <h2 className="text-lg font-semibold">{post.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{new Date(post.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })}</span>
          {post.channels.map((c) => (
            <span key={c} className="chip">
              {CHANNEL_LABEL[c]}
            </span>
          ))}
          <span>{POST_STATE_LABEL[post.state]}</span>
        </p>
      </div>
      <p role="status" className="card border-info/30 bg-info/10 text-sm">
        <strong>A cobrança ainda não começou.</strong> Nada é cobrado por enquanto.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2" aria-label="O que a Ekoai fez neste post">
          <h3 className="text-base font-semibold">O que a Ekoai fez neste post</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
        <section className="card space-y-2" aria-label="Ajustes neste post">
          <h3 className="text-base font-semibold">Ajustes neste post</h3>
          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between py-2">
              <dt>Ajustes de design</dt>
              <dd className="font-semibold">{post.designEdits}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt>Consertos do avaliador</dt>
              <dd className="font-semibold">{post.fixes}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">Ajustes, novas tentativas e avaliações não contam como post novo.</p>
        </section>
      </div>
    </div>
  );
}
