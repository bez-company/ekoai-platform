import Link from 'next/link';
import { notFound } from 'next/navigation';
import GenerationProgress from '@/components/posts/GenerationProgress';
import { pageError } from '@/lib/api';
import { postProgress } from '@/lib/post-requests';
import { isUuid } from '@/lib/route-input';
import { pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

const KIND_LABEL = { informativo: 'Informativo', atmosfera: 'Atmosfera' } as const;

// O andamento de um pedido (SPEC 012 R1): etapas, falha com nova tentativa, e o caminho para Aprovar.
export default async function GeneratingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const t = await pageTenant();
  try {
    const progress = await postProgress(t, id);
    if (!progress) notFound();
    return (
      <div className="space-y-4">
        <Link href="/create" className="text-sm text-muted hover:text-fg">
          ← Criar post
        </Link>
        <div>
          <h1 className="text-xl font-semibold">{progress.status === 'ready' ? 'Post pronto' : progress.status === 'failed' ? 'Não deu para gerar o post' : 'Criando o post'}</h1>
          <p className="text-sm text-muted">
            {progress.idea}
            {progress.kind ? ` · ${KIND_LABEL[progress.kind]}` : ''} · Retrato 4:5
          </p>
        </div>
        <GenerationProgress initial={progress} />
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/create/[id]')}</div>;
  }
}
