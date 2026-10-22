import { notFound } from 'next/navigation';
import MediaLibrary from '@/components/media/MediaLibrary';
import { pageError } from '@/lib/api';
import { listMediaAssets } from '@/lib/media-assets';
import { MEDIA_MAX_PER_ACCOUNT } from '@/lib/media-asset-model';
import { can, pageSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Banco de imagens (SPEC 017 decisão 9, BEZ-252). Quem cria conteúdo (administrador e criador); o
// leitor não vê a tela. Editar a descrição, autorizar e apagar pede content.edit.
export default async function MediaPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { t } = await pageSession();
  if (!(await can('content.create'))) notFound();
  const { filter } = await searchParams;
  try {
    const [assets, canEdit] = await Promise.all([listMediaAssets(t, { filter: 'all', tag: null, limit: MEDIA_MAX_PER_ACCOUNT }), can('content.edit')]);
    return <MediaLibrary initial={assets} initialFilter={filter === 'unused' || filter === 'used' ? filter : 'all'} canEdit={canEdit} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/media')}</div>;
  }
}
