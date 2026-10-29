import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIdeaTabs, getPending } from '@/lib/queries';
import NetworkTabs from '@/components/posts/NetworkTabs';
import SignalPanel from '@/components/posts/SignalPanel';
import ApproveAllBar, { type BarNetwork } from '@/components/posts/ApproveAllBar';
import NetworkSwitch from '@/components/posts/NetworkSwitch';
import { networkFormatLabel } from '@/lib/ideas-model';
import { fmtLocal } from '@/lib/scheduling';
import { listSocialAccounts } from '@/lib/social-accounts';
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
  // Uma ideia para mais de uma rede (SPEC 028): as abas levam de uma pendência à outra. Falhar aqui nunca derruba a tela.
  const tabs = p.brief_id ? await getIdeaTabs(t, p.brief_id).catch(() => []) : [];
  const NAMES: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };
  const canEditText = await can('content.edit');
  const tabsNav = (
    <>
      <NetworkTabs tabs={tabs} current={p.channel} briefId={p.brief_id} />
      {tabs.filter((x) => x.pendingId).length > 1 && <NetworkSwitch pendingId={p.pending_id} name={NAMES[p.channel] ?? p.channel} />}
      <SignalPanel pendingId={p.pending_id} channel={p.channel} stored={p.generation?.critic} canEdit={canEditText} />
    </>
  );
  // A barra "Aprovar as N redes" (BEZ-436): as redes prontas desta ideia, com o formato e o próximo horário de cada uma.
  // Falhar aqui nunca derruba a tela: sem a barra, cada aba aprova a própria rede.
  const bar: BarNetwork[] = await (async () => {
    if (!p.brief_id || tabs.filter((x) => x.state === 'ready').length < 2) return [];
    const accounts = await listSocialAccounts(t).catch(() => []);
    const rows = await Promise.all(
      tabs
        .filter((x) => x.state === 'ready' && x.pendingId)
        .map(async (x) => {
          const other = x.pendingId === p.pending_id ? p : await getPending(t, x.pendingId!);
          const variation = other?.generation?.variations?.[0];
          const slot = other?.channel === p.channel ? nextSlot : await nextFreeSlot(t, x.channel).catch(() => null);
          return {
            channel: x.channel,
            name: NAMES[x.channel] ?? x.channel,
            pendingId: x.pendingId!,
            format: networkFormatLabel(x.channel, variation, composeCaption(variation).length),
            slot: slot ? fmtLocal(slot) : null,
            needsReconnect: accounts.some((a) => a.channel === x.channel && a.status === 'reauth_required'),
          };
        }),
    );
    return rows;
  })().catch((e) => (log('warn', 'inbox', 'não montou a barra de aprovar as redes', { error: e instanceof Error ? e.message : String(e) }), []));
  const barEl = bar.length > 1 && p.brief_id ? <ApproveAllBar briefId={p.brief_id} networks={bar} /> : null;

  // Post feito pela Ekoai (SPEC 012) ou foto do banco (Publicar foto, BEZ-254): a tela da moldura do
  // feed, com os atalhos e os fatos usados.
  // O texto do LinkedIn (e das outras redes) usa a tela das redes, com legenda editável, imagem ou só texto e o horário da rede;
  // só o post do Instagram tem a tela da imagem, com o Studio e o pedido de ajuste.
  if ((p.post_design_id && p.channel === 'instagram') || p.seed?.source === 'photo') {
    const [account, profile, facts, canApprove, canEdit, canManage] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t), can('content.approve'), can('content.edit'), can('brand.manage')]);
    const max = account?.plan.maxPostsPerMonth ?? 20;
    const usage = await monthlyUsage(t, max);
    // As versões do design e o atalho para o Studio (SPEC 019 e 024): só para post com design. Falhar aqui nunca derruba a tela.
    const design = p.post_design_id && p.brief_id && p.seed?.source !== 'photo' ? await designState(t, p.brief_id).catch((e) => (log('warn', 'inbox', 'não leu o design do post', { error: e instanceof Error ? e.message : String(e) }), null)) : null;
    const handle = profile?.instagramHandle ? `@${profile.instagramHandle}` : (account?.name ?? 'sua conta');
    return (
      <div className="space-y-4">
        {tabsNav}
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
        {barEl}
      </div>
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
      {tabsNav}
      <ApproveForm pending={p} suggested={suggested} nextSlot={nextSlot} />
      {barEl}
    </div>
  );
}
