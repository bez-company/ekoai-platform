import { notFound, redirect } from 'next/navigation';
import { getPending } from '@/lib/queries';
import { accountOf } from '@/lib/accounts';
import { getProfile } from '@/lib/company-profile';
import { monthlyUsage } from '@/lib/generation-db';
import { can, pageSession } from '@/lib/session';
import { brandFromProfile } from '@/lib/design/model';
import { designState } from '@/lib/post-design-revisions';
import Studio from '@/components/studio/Studio';

export const dynamic = 'force-dynamic';

// O Studio do post (SPEC 027, BEZ-381): editor livre em camadas. Só para post com design da Ekoai (uma imagem ou, com ?lamina=n, uma
// lâmina do carrossel); foto do banco e post sem design voltam para Aprovar. A cena vem de GET /api/posts/[id]/design/scene.
export default async function StudioPage({ params, searchParams }: { params: Promise<{ pendingId: string }>; searchParams: Promise<{ lamina?: string }> }) {
  const { pendingId } = await params;
  const { lamina } = await searchParams;
  const { t } = await pageSession();
  const id = decodeURIComponent(pendingId);
  const p = await getPending(t, id);
  if (!p) notFound();
  if (!p.post_design_id || !p.brief_id || p.seed?.source === 'photo') redirect(`/aprovar/${encodeURIComponent(id)}`);

  const [account, profile, canEdit, state] = await Promise.all([accountOf(t.tenantId), getProfile(t), can('content.edit'), designState(t, p.brief_id)]);
  const usage = await monthlyUsage(t, account?.plan.maxPostsPerMonth ?? 20);
  const brand = brandFromProfile(profile);
  // As cores da marca primeiro, depois branco e quase preto; sem repetir.
  const swatches = [
    { label: 'Cor principal da marca', hex: brand.primary },
    { label: 'Cor de destaque da marca', hex: brand.accent },
    { label: 'Cor do texto da marca', hex: brand.ink },
    { label: 'Branco', hex: '#FFFFFF' },
    { label: 'Quase preto', hex: '#1F1A19' },
  ].filter((s, i, all) => all.findIndex((x) => x.hex.toLowerCase() === s.hex.toLowerCase()) === i);
  // Carrossel: a lâmina vem de ?lamina=n (a partir de 1); fora da faixa, a primeira. Uma imagem ignora o parâmetro.
  const urls = (p.images ?? []).map((i) => i.url).filter((u): u is string => !!u);
  const carousel = !!state.slides && urls.length === state.slides.length;
  const asked = Number(lamina);
  const slide = carousel ? (Number.isInteger(asked) && asked >= 1 && asked <= urls.length ? asked - 1 : 0) : undefined;

  return <Studio pendingId={id} briefId={p.brief_id} title={p.generation?.variations?.[0]?.hook ?? 'Post'} slide={slide} slideUrls={carousel ? urls : undefined} canEdit={canEdit} decided={state.decided} swatches={swatches} state={state} usage={usage} />;
}
