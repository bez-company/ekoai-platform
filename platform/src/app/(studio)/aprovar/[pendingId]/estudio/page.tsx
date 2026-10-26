import { notFound, redirect } from 'next/navigation';
import { getPending } from '@/lib/queries';
import { accountOf } from '@/lib/accounts';
import { getProfile } from '@/lib/company-profile';
import { monthlyUsage } from '@/lib/generation-db';
import { can, pageSession } from '@/lib/session';
import { designState } from '@/lib/post-design-revisions';
import { brandFromProfile } from '@/lib/design/model';
import { ratioOf } from '@/lib/media-view';
import Studio from '@/components/studio/Studio';

export const dynamic = 'force-dynamic';

// O Estúdio de edição do post (SPEC 024, BEZ-315): a imagem grande, os elementos e as propriedades. Só para
// post com design da Ekoai; foto do banco e post sem design voltam para Aprovar.
export default async function StudioPage({ params }: { params: Promise<{ pendingId: string }> }) {
  const { pendingId } = await params;
  const { t } = await pageSession();
  const id = decodeURIComponent(pendingId);
  const p = await getPending(t, id);
  if (!p) notFound();
  if (!p.post_design_id || !p.brief_id || p.seed?.source === 'photo') redirect(`/aprovar/${encodeURIComponent(id)}`);

  const [account, profile, canEdit, canManage, state] = await Promise.all([accountOf(t.tenantId), getProfile(t), can('content.edit'), can('brand.manage'), designState(t, p.brief_id)]);
  const usage = await monthlyUsage(t, account?.plan.maxPostsPerMonth ?? 20);
  const brand = brandFromProfile(profile);
  const swatches = [
    { label: 'Cor principal da marca', hex: brand.primary },
    { label: 'Cor de destaque da marca', hex: brand.accent },
    { label: 'Cor do texto da marca', hex: brand.ink },
    { label: 'Branco', hex: '#FFFFFF' },
    { label: 'Quase preto', hex: '#1F1A19' },
  ].filter((s, i, all) => all.findIndex((x) => x.hex.toLowerCase() === s.hex.toLowerCase()) === i);
  const kind = p.post_kind ?? (p.seed?.kind as string | undefined) ?? 'informativo';

  return (
    <Studio
      pendingId={id}
      briefId={p.brief_id}
      title={p.generation?.variations?.[0]?.hook ?? 'Post'}
      kind={kind === 'atmosfera' ? 'atmosfera' : 'informativo'}
      ratio={ratioOf(p.seed?.ratio)}
      imageUrl={p.images?.find((i) => i.url)?.url ?? null}
      state={state}
      swatches={swatches}
      usage={usage}
      canEdit={canEdit}
      canManage={canManage}
    />
  );
}
