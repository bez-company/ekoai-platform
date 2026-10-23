import CampaignForm from '@/components/campaigns/CampaignForm';
import { emptyForm, formFromCampaign, type FormInitial } from '@/lib/campaign-form-model';
import { pageError } from '@/lib/api';
import { getCampaign } from '@/lib/campaigns';
import { isCampaignId, todayLocal } from '@/lib/campaign-model';
import { pageContext } from '@/lib/session';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// Nova campanha (SPEC 018). Só quem gere a marca (brand.manage). `?from=` duplica uma campanha: copia o que ela
// diz e deixa as datas em branco.
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { t } = await pageContext('brand.manage');
  const { from } = await searchParams;
  const today = todayLocal();
  let initial: FormInitial = emptyForm(today);
  let profilePosts: number | null = null;
  try {
    if (isCampaignId(from)) {
      const c = await getCampaign(t, from).catch(() => null);
      if (c) initial = formFromCampaign(c, 'duplicate', today);
    }
    const profile = await t.select('company_profiles', 'posts_per_week').maybeSingle();
    profilePosts = typeof profile.data?.posts_per_week === 'number' ? (profile.data.posts_per_week as number) : null;
  } catch (e) {
    pageError(e, 'page/campaigns/new');
  }
  return (
    <div className="space-y-5">
      <div>
        <Link href="/campaigns" className="link text-sm">
          ← Campanhas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nova campanha</h1>
        <p className="text-sm text-muted">Diga ao coordenador o que você quer com os posts.</p>
      </div>
      <CampaignForm initial={initial} profilePosts={profilePosts} />
    </div>
  );
}
