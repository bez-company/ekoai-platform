import Link from 'next/link';
import { notFound } from 'next/navigation';
import CampaignActions from '@/components/campaigns/CampaignActions';
import { StatusBadge } from '@/components/campaigns/Badge';
import Suggestions, { type SuggestionView } from '@/components/home/Suggestions';
import { pageError } from '@/lib/api';
import { campaignInEffect, isCampaignId, type Campaign, type CampaignProgress } from '@/lib/campaign-model';
import { ENGAGEMENT_NOTE, STATUS_BADGE, daysLeftLabel, elapsedPercent, engagementView, kindLabel, periodLabel, shortCampaignName } from '@/lib/campaign-view';
import { campaignProgress, getCampaign } from '@/lib/campaigns';
import { listSuggestions } from '@/lib/content-coordinator';
import { NotFoundError } from '@/lib/errors';
import { slotParts } from '@/lib/home-model';
import { can, pageTenant, requireSession } from '@/lib/session';
import { tzOffsetHours } from '@/lib/slots';

export const dynamic = 'force-dynamic';

const CTA_LABEL = { link_bio: 'Link na bio', whatsapp: 'WhatsApp', dm: 'Mensagem direta' } as const;

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
      <b className="block text-xl font-semibold">{value}</b>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

// Detalhe da campanha (SPEC 018; protótipo v12): estado, progresso, a sequência da semana com o motivo de cada
// post, engajamento (nunca venda) e o que a campanha diz. Todos leem; só quem gere a marca muda o estado.
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await pageTenant();
  const { id } = await params;
  if (!isCampaignId(id)) notFound();
  const [manage, create] = await Promise.all([can('brand.manage'), can('content.create')]);
  const { user } = await requireSession();
  const nowMs = Date.now();

  let campaign: Campaign;
  let progress: CampaignProgress | null = null;
  let suggestions: SuggestionView[] = [];
  let failed = false;
  try {
    campaign = await getCampaign(t, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    pageError(e, 'page/campaigns/detail');
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <strong>Não foi possível carregar a campanha.</strong> Ela está salva. Recarregue a página em instantes.
      </div>
    );
  }
  const tz = tzOffsetHours();
  if (campaign.status !== 'draft') {
    try {
      progress = await campaignProgress(t, id, new Date(nowMs));
      const name = shortCampaignName(campaign.name);
      suggestions = (await listSuggestions(t, new Date(nowMs))).map((s) => ({ id: s.id, ...slotParts(s.slotAt, tz), goalLabel: s.goalLabel, idea: s.idea, reason: s.reason, assetId: s.assetId, campaignName: s.campaignId === id ? name : null }));
    } catch (e) {
      pageError(e, 'page/campaigns/detail');
      failed = true;
    }
  }

  const badge = STATUS_BADGE[campaign.status];
  const live = campaign.status === 'active' || campaign.status === 'paused';
  const inEffect = campaignInEffect(campaign);
  const mine = suggestions.filter((s) => s.campaignName).length;
  const eng = progress ? engagementView(progress.engagement) : null;
  const kpis: [string, string][] = progress
    ? campaign.status === 'ended'
      ? [[String(progress.published), 'publicados'], [String(progress.scheduled), 'agendados'], [String(progress.created), 'sugestões criadas'], [eng?.campaign ?? 'sem dado', 'engajamento']]
      : [[daysLeftLabel(progress.daysLeft).replace(/^Faltam? /, ''), progress.daysLeft === 1 ? 'dia restante' : 'dias restantes'], [String(progress.published), 'publicados'], [String(progress.scheduled), 'agendados'], [progress.cadence.target ? `${progress.cadence.thisWeek} de ${progress.cadence.target}` : String(progress.cadence.thisWeek), 'posts esta semana']]
    : [];
  const data: [string, string | null][] = [
    ['Resultado', campaign.objective],
    ['Oferta', campaign.offering],
    ['Público', campaign.audience],
    ['Chamada para ação', campaign.cta ? CTA_LABEL[campaign.cta] : 'A do perfil'],
    ['Não pode dizer', campaign.restrictions.length ? campaign.restrictions.join(', ') : null],
    ['Meta', campaign.targetLabel ? `${campaign.targetLabel}${campaign.targetValue !== null ? `: ${campaign.targetValue}` : ''}` : null],
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/campanhas" className="link text-sm">
          ← Campanhas
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge label={badge.label} tone={badge.tone} />
            <StatusBadge label={kindLabel(campaign)} tone="accent" />
            <span className="text-sm text-muted">{periodLabel(campaign)}</span>
          </div>
        </div>
        {manage && user && <CampaignActions id={campaign.id} status={campaign.status} />}
      </div>

      {campaign.status === 'draft' && (
        <div role="status" className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
          <strong>Esta campanha ainda é um rascunho.</strong> O coordenador só a usa depois que você confirmar.
        </div>
      )}
      {campaign.status === 'paused' && (
        <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <strong>Campanha pausada.</strong> As sugestões voltam a seguir só a rotação até você retomar.
        </div>
      )}
      {campaign.status === 'active' && !inEffect && (
        <div role="status" className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
          <strong>Fora do prazo.</strong> A campanha está ativa, mas hoje não cai entre as datas dela: o coordenador não a usa até lá.
        </div>
      )}
      {campaign.status === 'ended' && progress && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
          <strong>Campanha encerrada.</strong> {progress.published === 1 ? '1 post publicado' : `${progress.published} posts publicados`}
          {eng ? `, com engajamento de ${eng.campaign}${eng.account ? ` (média da conta: ${eng.account})` : ''}` : ''}. O coordenador voltou à rotação.
        </div>
      )}
      {failed && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <strong>Não foi possível carregar o progresso.</strong> A campanha está salva. Recarregue a página em instantes.
        </div>
      )}

      {progress && (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {kpis.map(([v, l]) => (
              <Kpi key={l} value={v} label={l} />
            ))}
          </div>
          {live && (
            <div className="h-1.5 overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={elapsedPercent(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Tempo da campanha">
              <i className="block h-full rounded-full bg-accent" style={{ width: `${elapsedPercent(progress)}%` }} />
            </div>
          )}
        </>
      )}

      {campaign.status === 'active' && suggestions.length > 0 && (
        <div className="space-y-1">
          <Suggestions items={suggestions} canCreate={create && !!user} title="Sequência desta semana" />
          <p className="px-1 text-sm text-muted">{mine === 1 ? '1 das sugestões serve a esta campanha' : `${mine} das ${suggestions.length} sugestões servem a esta campanha`}. Nada é criado sem você pedir.</p>
        </div>
      )}

      {progress && campaign.status !== 'draft' && (
        <section className="card space-y-2">
          <h2 className="text-lg font-semibold">Engajamento</h2>
          {eng ? (
            <div className="grid grid-cols-3 gap-2.5">
              <Kpi value={eng.campaign} label="da campanha" />
              <Kpi value={eng.account ?? 'sem dado'} label="média da conta" />
              <Kpi value={eng.diff ?? 'sem dado'} label="diferença" />
            </div>
          ) : (
            <p className="text-sm text-muted">Ainda sem posts publicados com números para comparar.</p>
          )}
          <p className="text-sm text-muted">{ENGAGEMENT_NOTE}</p>
        </section>
      )}

      <section className="card">
        <h2 className="text-lg font-semibold">O que a campanha diz</h2>
        <dl className="mt-2 divide-y divide-line text-sm">
          {data.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="shrink-0 text-muted">{k}</dt>
              <dd className="min-w-0 text-right">{v ?? <span className="text-muted">Sem {k === 'Não pode dizer' ? 'restrições' : k === 'Meta' ? 'meta' : 'dado'}</span>}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted">
          Preço e prazo escritos aqui valem só para os posts desta campanha.{' '}
          <Link href="/configuracoes/fatos" className="link">
            Ver fatos da empresa
          </Link>
        </p>
      </section>
    </div>
  );
}
