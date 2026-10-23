// CampaignCards.tsx: a campanha no Início (SPEC 018, protótipo v12): o cartão de progresso da campanha ativa e o
// convite para criar a primeira. Servidor puro. Só posts, cadência e prazo; nunca venda.

import Link from 'next/link';
import { CampaignTag, StatusBadge } from './Badge';
import { cadenceLabel, daysLeftLabel, elapsedPercent, kindLabel, periodLabel } from '@/lib/campaign-view';
import type { Campaign, CampaignProgress } from '@/lib/campaign-model';

export function CampaignProgressCard({ campaign, progress }: { campaign: Campaign; progress: CampaignProgress }) {
  const percent = elapsedPercent(progress);
  const lines: [string, string][] = [
    ['Publicados', String(progress.published)],
    ['Agendados', String(progress.scheduled)],
    ['Esta semana', cadenceLabel(progress)],
  ];
  return (
    <section className="card" aria-label="Campanha ativa">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Campanha ativa</h2>
        <StatusBadge label="Ativa" tone="success" />
      </div>
      <p className="mt-2 font-semibold">{campaign.name}</p>
      <p className="text-sm text-muted">
        {kindLabel(campaign)} · {periodLabel(campaign)} · {daysLeftLabel(progress.daysLeft).toLowerCase()}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Tempo da campanha">
        <i className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <dl className="mt-3 divide-y divide-line text-sm">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/campanhas/${campaign.id}`} className="link mt-1 inline-block text-sm">
        Ver a campanha
      </Link>
    </section>
  );
}

export function CampaignInvite({ canManage }: { canManage: boolean }) {
  return (
    <section className="card py-6 text-center" aria-label="Campanhas">
      <h2 className="text-lg font-semibold">Diga o que você quer com os posts</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {canManage ? 'Crie uma campanha e as sugestões da semana passam a servir a ela.' : 'Quando quem administra a conta criar uma campanha, ela orienta as sugestões.'}
      </p>
      {canManage && (
        <Link href="/campanhas/nova" className="btn-primary mt-3">
          Criar campanha
        </Link>
      )}
    </section>
  );
}

// A faixa da Agenda: a campanha ativa, o que falta e o ritmo da semana, acima da grade.
export function CampaignStrip({ campaign, progress }: { campaign: Campaign; progress: CampaignProgress }) {
  const percent = progress.cadence.target ? Math.min(100, Math.round((progress.cadence.thisWeek / progress.cadence.target) * 100)) : 0;
  return (
    <section className="card" aria-label="Campanha ativa">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CampaignTag name="Campanha ativa" />
          <p className="mt-1.5">
            <strong>{campaign.name}</strong> <span className="text-sm text-muted">· {daysLeftLabel(progress.daysLeft).toLowerCase()} · {cadenceLabel(progress)} esta semana</span>
          </p>
        </div>
        <Link href={`/campanhas/${campaign.id}`} className="link text-sm">
          Ver a campanha
        </Link>
      </div>
      {progress.cadence.target ? (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Posts da semana">
          <i className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </section>
  );
}
