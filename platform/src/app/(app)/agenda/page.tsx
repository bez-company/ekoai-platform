import Link from 'next/link';
import { Suspense } from 'react';
import ScheduledCard from '@/components/ScheduledCard';
import AgendaPostCell from '@/components/agenda/AgendaPostCell';
import SlotCell from '@/components/agenda/SlotCell';
import { NoSlots, SlotsButton } from '@/components/agenda/AgendaActions';
import { getAgenda } from '@/lib/agenda';
import { CampaignStrip } from '@/components/campaigns/CampaignCards';
import type { Campaign, CampaignProgress } from '@/lib/campaign-model';
import { campaignInEffect, todayLocal } from '@/lib/campaign-model';
import { shortCampaignName } from '@/lib/campaign-view';
import { campaignProgress, listCampaigns } from '@/lib/campaigns';
import { agendaCounts, agendaTitle, dayOfMonth, parseAgendaQuery, WEEKDAY_SHORT, type Agenda, type AgendaDay } from '@/lib/agenda-model';
import { loadRecommendation } from '@/lib/content-analysis';
import type { Recommendation } from '@/lib/content-analysis-model';
import { getActiveSlots, tzOffsetHours } from '@/lib/slots';
import { can, pageSession } from '@/lib/session';
import { pageError } from '@/lib/api';
import type { PublishSlot } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Agenda (SPEC 017 decisão 13): a semana (padrão) ou o mês, com os horários de publicação dentro
// dela. Horário vazio mostra a sugestão do coordenador; ocupado mostra o post. A fila sem horário
// fica em cima, e "Horários" edita a grade aqui mesmo (?edit=slots abre direto).

type Params = { view?: string; date?: string; edit?: string };

const qs = (view: string, date: string) => `/agenda?view=${view}&date=${date}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t } = await pageSession();
  const params = new URLSearchParams(Object.entries(await searchParams).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const query = parseAgendaQuery(params, Date.now(), tzOffsetHours());
  let agenda: Agenda | null = null;
  let slots: PublishSlot[] = [];
  let err = '';
  const [canManage, canCreate] = await Promise.all([can('publishing.manage'), can('content.create')]);
  try {
    [agenda, slots] = await Promise.all([getAgenda(t, query, { slotChannel: 'instagram' }), getActiveSlots(t, 'instagram')]);
  } catch (e) {
    err = pageError(e, 'page/calendar');
  }
  const slotList = slots.map((s) => ({ weekday: s.weekday, hour: s.hour, minute: s.minute }));
  // SPEC 022: o diálogo de Horários recomenda os melhores horários; sem a leitura, abre como sempre.
  let recommendation: Recommendation | null = null;
  if (canManage) {
    try {
      recommendation = await loadRecommendation(t);
    } catch (e) {
      pageError(e, 'page/calendar/recommendation');
    }
  }
  // Campanhas (SPEC 018): a Agenda segue sem elas se a leitura falhar.
  let campaignNames = new Map<string, string>();
  let strip: { campaign: Campaign; progress: CampaignProgress } | null = null;
  try {
    const campaigns = await listCampaigns(t);
    campaignNames = new Map(campaigns.map((c) => [c.id, shortCampaignName(c.name)]));
    const active = campaigns.find((c) => campaignInEffect(c, todayLocal()));
    if (active) strip = { campaign: active, progress: await campaignProgress(t, active.id) };
  } catch {
    strip = null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agenda</h1>
          <p className="text-sm text-muted">Aprovados esperando a hora de publicar. Os publicados ficam no Histórico.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Período" className="flex gap-1 rounded-full border border-line bg-inset p-1">
            {(['week', 'month'] as const).map((v) => (
              <Link key={v} href={qs(v, query.date)} aria-current={query.view === v ? 'page' : undefined} className={`rounded-full px-3 py-1 text-sm font-semibold ${query.view === v ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
                {v === 'week' ? 'Semana' : 'Mês'}
              </Link>
            ))}
          </nav>
          {canManage && (
            <Suspense>
              <SlotsButton slots={slotList} recommendation={recommendation} />
            </Suspense>
          )}
        </div>
      </div>

      {err && <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>}

      {agenda && agenda.queue.length > 0 && (
        <section className="card space-y-3" aria-labelledby="fila">
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <strong id="fila">{agenda.queue.length === 1 ? '1 post aprovado espera horário.' : `${agenda.queue.length} posts aprovados esperam horário.`}</strong> Ele entra no próximo horário que você criar, ou publique agora.
          </div>
          <div className="grid gap-2">
            {agenda.queue.map((p) => (
              <ScheduledCard key={p.id} post={p} time="sem horário" />
            ))}
          </div>
        </section>
      )}

      {strip && <CampaignStrip campaign={strip.campaign} progress={strip.progress} />}

      {agenda && agenda.slots === 0 ? (
        <Suspense>
          <NoSlots canManage={canManage} />
        </Suspense>
      ) : agenda ? (
        <AgendaBody agenda={agenda} canCreate={canCreate} campaignNames={campaignNames} />
      ) : null}
    </div>
  );
}

function AgendaBody({ agenda, canCreate, campaignNames }: { agenda: Agenda; canCreate: boolean; campaignNames: Map<string, string> }) {
  const counts = agendaCounts(agenda);
  const failed = agenda.days.flatMap((d) => d.cells).filter((c) => c.post?.status === 'failed').length;
  return (
    <section className="card space-y-4" aria-label={`Agenda de ${agendaTitle(agenda)}`}>
      {failed > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {failed === 1 ? '1 post não foi publicado.' : `${failed} posts não foram publicados.`} Abra o post para ver o motivo e tentar de novo.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={qs(agenda.view, agenda.prev)} className="btn-ghost min-h-9 px-3" aria-label={agenda.view === 'week' ? 'Semana anterior' : 'Mês anterior'}>
            ‹
          </Link>
          <Link href={qs(agenda.view, agenda.next)} className="btn-ghost min-h-9 px-3" aria-label={agenda.view === 'week' ? 'Próxima semana' : 'Próximo mês'}>
            ›
          </Link>
          <strong className="ml-2">{agendaTitle(agenda)}</strong>
        </div>
        <span className="text-sm text-muted">
          {counts.posts === 1 ? '1 post' : `${counts.posts} posts`} · {counts.slots === 1 ? '1 horário' : `${counts.slots} horários`} {agenda.view === 'week' ? 'na semana' : 'no mês'}
        </span>
      </div>
      {agenda.view === 'week' ? <Week days={agenda.days} canCreate={canCreate} campaignNames={campaignNames} /> : <Month days={agenda.days} />}
    </section>
  );
}

function Week({ days, canCreate, campaignNames }: { days: AgendaDay[]; canCreate: boolean; campaignNames: Map<string, string> }) {
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((d) => (
        <div key={d.date} className={`min-h-0 min-w-0 rounded-md border bg-raised p-2 md:min-h-40 ${d.today ? 'border-accent/60' : 'border-line'}`}>
          <h3 className={`mb-2 text-xs font-semibold ${d.today ? 'text-accent-text' : 'text-muted'}`}>
            {WEEKDAY_SHORT[d.weekday]} {dayOfMonth(d.date)}
            {d.today ? ' · hoje' : ''}
          </h3>
          <div className="grid gap-1.5">
            {d.cells.map((c) =>
              c.post ? <AgendaPostCell key={`${c.at}-${c.post.id}`} post={c.post} time={c.time} /> : c.kind === 'slot' ? <SlotCell key={`${c.at}-${c.slotId}`} time={c.time} past={d.past} suggestion={c.suggestion} canCreate={canCreate} campaignName={c.suggestion?.campaignId ? campaignNames.get(c.suggestion.campaignId) ?? null : null} /> : null,
            )}
            {d.cells.length === 0 && <span className="text-xs text-muted">Sem horário</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Month({ days }: { days: AgendaDay[] }) {
  return (
    <div className="grid grid-cols-7 gap-1 md:gap-1.5">
      {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => (
        <span key={w} className="text-center text-xs font-semibold text-muted">
          {w}
        </span>
      ))}
      {days.map((d) => {
        const posts = d.cells.filter((c) => c.post).length;
        const free = d.cells.filter((c) => c.kind === 'slot' && !c.post && !d.past).length;
        return (
          <Link
            key={d.date}
            href={qs('week', d.date)}
            aria-label={`${dayOfMonth(d.date)}: ${posts} ${posts === 1 ? 'post' : 'posts'}${free ? `, ${free} ${free === 1 ? 'horário livre' : 'horários livres'}` : ''}. Abrir a semana`}
            className={`min-h-14 rounded-sm border border-line bg-raised p-1.5 text-xs hover:border-accent/60 md:min-h-20 ${d.inRange ? '' : 'opacity-40'}`}
          >
            <span className="font-semibold">{dayOfMonth(d.date)}</span>
            <span className="mt-1 flex flex-wrap gap-1" aria-hidden="true">
              {Array.from({ length: posts }, (_, i) => (
                <i key={`p${i}`} className="inline-block h-2 w-2 rounded-full bg-accent" />
              ))}
              {Array.from({ length: free }, (_, i) => (
                <i key={`f${i}`} className="inline-block h-2 w-2 rounded-full border border-line-strong" />
              ))}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
