import { notFound } from 'next/navigation';
import PhotoPostForm from '@/components/photo/PhotoPostForm';
import { accountOf } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { getMediaAsset } from '@/lib/media-assets';
import { blockedReason, toPicked } from '@/lib/media-view';
import { isUuid } from '@/lib/route-input';
import { nextFreeSlot } from '@/lib/slots';
import { can, pageSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Publicar foto (SPEC 017 decisão 10, BEZ-243). Quem cria conteúdo. `?asset=<id>` abre com a foto do
// banco (atalho do banco, do Início e da Agenda); `?idea=` vai para a legenda que a Ekoai escreve.
export default async function PhotoPage({ searchParams }: { searchParams: Promise<{ asset?: string; idea?: string }> }) {
  const { t } = await pageSession();
  if (!(await can('content.create'))) notFound();
  const { asset, idea } = await searchParams;
  try {
    const [account, profile, nextSlot, canApprove, initial] = await Promise.all([
      accountOf(t.tenantId),
      getProfile(t),
      nextFreeSlot(t, 'instagram').catch(() => null),
      can('content.approve'),
      asset && isUuid(asset) ? getMediaAsset(t, asset) : Promise.resolve(null),
    ]);
    const picked = initial ? toPicked(initial) : null;
    const handle = profile?.instagramHandle ? `@${profile.instagramHandle}` : (account?.name ?? 'sua conta');
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Publicar foto</h1>
          <p className="text-sm text-muted">Foto pronta, sem gerar imagem. Escreva a legenda ou peça para a Ekoai escrever olhando a foto.</p>
        </div>
        {asset && !initial && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
            A foto escolhida não está mais no banco de imagens. Escolha outra abaixo.
          </p>
        )}
        <PhotoPostForm
          handle={handle}
          accountName={account?.name ?? ''}
          nextSlot={nextSlot}
          canApprove={canApprove}
          initialPhoto={picked && !blockedReason(picked) ? picked : null}
          initialIdea={(idea ?? '').slice(0, 300)}
        />
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/photo')}</div>;
  }
}
