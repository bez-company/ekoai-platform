import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPending } from '@/lib/queries';
import { nextFreeSlot } from '@/lib/slots';
import { composeCaption } from '@/lib/caption';
import ApproveForm from '@/components/ApproveForm';
import PostReview from '@/components/posts/PostReview';
import { accountOf } from '@/lib/accounts';
import { getProfile } from '@/lib/company-profile';
import { listFacts } from '@/lib/company-facts';
import { monthlyUsage } from '@/lib/generation-db';
import { can, pageSession } from '@/lib/session';
import { designState } from '@/lib/post-design-revisions';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export default async function ApprovePage({ params }: { params: Promise<{ pendingId: string }> }) {
  const { pendingId } = await params;
  const { t } = await pageSession();
  const decoded = decodeURIComponent(pendingId);
  const p = await getPending(t, decoded);
  if (!p) notFound();

  const nextSlot = await nextFreeSlot(t, p.channel).catch(() => null);

  // Post feito pela Ekoai (SPEC 012) ou foto do banco (Publicar foto, BEZ-254): a tela da moldura do
  // feed, com os atalhos e os fatos usados.
  if (p.post_design_id || p.seed?.source === 'photo') {
    const [account, profile, facts, canApprove, canEdit, canManage] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t), can('content.approve'), can('content.edit'), can('brand.manage')]);
    const max = account?.plan.maxPostsPerMonth ?? 20;
    const usage = await monthlyUsage(t, max);
    // As versões do design e o atalho para o Estúdio (SPEC 019 e 024): só para post com design. Falhar aqui nunca derruba a tela.
    const design = p.post_design_id && p.brief_id && p.seed?.source !== 'photo' ? await designState(t, p.brief_id).catch((e) => (log('warn', 'inbox', 'não leu o design do post', { error: e instanceof Error ? e.message : String(e) }), null)) : null;
    const handle = profile?.instagramHandle ? `@${profile.instagramHandle}` : (account?.name ?? 'sua conta');
    return (
      <PostReview
        pending={p}
        suggested={composeCaption(p.generation?.variations?.[0])}
        nextSlot={nextSlot}
        handle={handle}
        accountName={account?.name ?? ''}
        usage={usage}
        facts={facts.filter((f) => f.active).map((f) => ({ id: f.id, kind: f.kind, text: f.text }))}
        canApprove={canApprove}
        canEdit={canEdit}
        canManage={canManage}
        design={design ? { state: design } : null}
      />
    );
  }

  // legenda sugerida por variação (corpo + hashtags)
  const suggested: Record<number, string> = {};
  for (const v of p.generation?.variations || []) suggested[v.id] = composeCaption(v);

  return (
    <div className="space-y-4">
      <Link href="/aprovar" className="text-sm text-muted hover:text-fg">
        ← voltar
      </Link>
      <ApproveForm pending={p} suggested={suggested} nextSlot={nextSlot} />
    </div>
  );
}
