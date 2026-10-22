import CoachMark from '@/components/onboarding/CoachMark';
import Guide from '@/components/onboarding/Guide';
import StaleApprovals from '@/components/onboarding/StaleApprovals';
import { LastPublishedCard, NextStepBar, Shortcuts, ThisWeek, type Shortcut } from '@/components/home/Panel';
import Suggestions, { type SuggestionView } from '@/components/home/Suggestions';
import { pageError } from '@/lib/api';
import { ROUTES } from '@/lib/app-routes';
import { listSuggestions, type Suggestion } from '@/lib/content-coordinator';
import { slotParts, slotsSummary, todayLine } from '@/lib/home-model';
import { homeSummary } from '@/lib/home-summary';
import { guideSummary } from '@/lib/onboarding';
import { loadGuide } from '@/lib/onboarding-data';
import { can, pageTenant, requireSession } from '@/lib/session';
import { getActiveSlots, tzOffsetHours } from '@/lib/slots';

export const dynamic = 'force-dynamic';

function suggestionView(s: Suggestion, tz: number): SuggestionView {
  return { id: s.id, ...slotParts(s.slotAt, tz), goalLabel: s.goalLabel, idea: s.idea, reason: s.reason, assetId: s.assetId };
}

// Início (SPEC 017, decisões 3, 11 e 12; protótipo v10). Conta nova vê o guia até a primeira
// publicação, com cada passo marcado pelo dado real. Depois dela, o painel: um próximo passo, os
// atalhos, as sugestões do coordenador, a semana e o último publicado. O leitor vê só o que acompanha.
export default async function HomePage() {
  const t = await pageTenant();
  const { role, user } = await requireSession();
  const first = user?.name?.trim().split(/\s+/)[0];
  const hello = first ? `Olá, ${first}` : 'Olá';
  const tz = tzOffsetHours();
  const nowMs = Date.now();

  if (role === 'viewer') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{hello}</h1>
          <p className="text-sm text-muted">Você acompanha esta conta como leitor.</p>
        </div>
        <section className="card py-8 text-center">
          <h2 className="text-lg font-semibold">Nenhum parecer pedido</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Quando a equipe pedir a sua opinião sobre um post, ele aparece em Aprovar para você aprovar ou pedir ajuste.</p>
        </section>
      </div>
    );
  }

  try {
    const [create, approve, publishing, channels, brand, team] = await Promise.all(
      (['content.create', 'content.approve', 'publishing.manage', 'channels.manage', 'brand.manage', 'team.manage'] as const).map((p) => can(p)),
    );
    const [view, summary, suggestions, slots, media] = await Promise.all([
      loadGuide(t, role, { create, approve, publishing, channels, brand, team }, nowMs),
      homeSummary(t, { approve, publishing, channels, create }, nowMs),
      listSuggestions(t, new Date(nowMs)),
      getActiveSlots(t, 'instagram'),
      Promise.all([t.select('media_assets', 'id', { count: 'exact', head: true }), t.select('media_assets', 'id', { count: 'exact', head: true }).is('used_at', null)]),
    ]);
    const sugg = suggestions.map((s) => suggestionView(s, tz));
    // As ações da sugestão registram quem decidiu: no login de senha única (sem pessoa) elas não existem.
    const canAct = create && !!user;
    const guide = view.guide;

    if (guide && !guide.hidden) {
      return (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">{hello}</h1>
            <p className="text-sm text-muted">{guideSummary(guide)}</p>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Guide guide={guide} />
            <div className="space-y-4">
              <StaleApprovals pending={view.pending} />
              <section className="card">
                <h2 className="text-lg font-semibold">Como funciona</h2>
                <p className="mt-1 text-sm text-muted">
                  Cada passo se marca sozinho quando acontece de verdade: o Instagram conectado, o post aprovado, a publicação no ar. Ao abrir uma tela pela primeira vez, uma dica curta mostra o que fazer ali.
                </p>
              </section>
              {sugg.length > 0 && <Suggestions items={sugg.slice(0, 1)} canCreate={canAct} title="Sugestão para começar" single />}
            </div>
          </div>
        </div>
      );
    }

    const [allMedia, unusedMedia] = media;
    const mediaTotal = allMedia.count ?? 0;
    const shortcuts: Shortcut[] = [
      ...(create
        ? [
            { icon: 'spark' as const, title: 'Criar post com IA', detail: 'Descreva e a Ekoai faz imagem e legenda', href: ROUTES.create },
            { icon: 'image' as const, title: 'Publicar uma foto', detail: 'Foto pronta, só legenda e horário', href: ROUTES.photo },
            { icon: 'grid' as const, title: 'Banco de imagens', detail: mediaTotal ? `${mediaTotal} ${mediaTotal === 1 ? 'foto' : 'fotos'}, ${unusedMedia.count ?? 0} ainda não ${unusedMedia.count === 1 ? 'usada' : 'usadas'}` : 'Suba as fotos da empresa', href: ROUTES.media },
          ]
        : []),
      { icon: 'clock' as const, title: 'Horários', detail: slotsSummary(slots), href: publishing ? ROUTES.slots : ROUTES.calendar },
    ];
    const when = (iso: string) => {
      const p = slotParts(iso, tz);
      return `${p.weekday} ${p.day} ${p.time}`;
    };

    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">{hello}</h1>
          <p className="text-sm text-muted">{todayLine(nowMs, tz)}</p>
        </div>
        <CoachMark id="home-panel" title="Este é o painel da semana." body="O próximo passo aparece em cima; as sugestões da Ekoai seguem os horários livres da agenda." />
        <StaleApprovals pending={view.pending} />
        <NextStepBar step={summary.next} />
        <Shortcuts items={shortcuts} />
        <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <Suggestions items={sugg.slice(0, 7)} canCreate={canAct} />
          <div className="space-y-5">
            <ThisWeek posts={summary.week} when={when} />
            <LastPublishedCard post={summary.lastPublished} />
          </div>
        </div>
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/home')}</div>;
  }
}
