import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import CampaignForm from '@/components/campaigns/CampaignForm';
import { formFromCampaign } from '@/lib/campaign-form-model';
import { NotFoundError } from '@/lib/errors';
import { getCampaign } from '@/lib/campaigns';
import { isCampaignId, todayLocal } from '@/lib/campaign-model';
import { pageContext } from '@/lib/session';
import { weeklyPosts } from '@/lib/slots';

export const dynamic = 'force-dynamic';

// Editar uma campanha em rascunho, ativa ou pausada (SPEC 018). Encerrada não muda: volta para o detalhe.
export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await pageContext('brand.manage');
  const { id } = await params;
  if (!isCampaignId(id)) notFound();
  const c = await getCampaign(t, id).catch((e) => {
    if (e instanceof NotFoundError) return null;
    throw e;
  });
  if (!c) notFound();
  if (c.status === 'ended' || c.status === 'archived') redirect(`/campanhas/${id}`);
  const initial = formFromCampaign(c, 'edit', todayLocal());
  return (
    <div className="space-y-5">
      <div>
        <Link href={`/campanhas/${id}`} className="link text-sm">
          ← {c.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Editar campanha</h1>
      </div>
      <CampaignForm initial={initial} profilePosts={await weeklyPosts(t)} />
    </div>
  );
}
