import Link from 'next/link';
import { getPendings } from '@/lib/queries';
import { listInProgress, type InProgressPost } from '@/lib/post-requests';
import { studioSteps } from '@/lib/generation-steps';
import { levelOf } from '@/lib/studio/levels';
import { Spinner } from '@/components/auth/ui';
import { fmtDateTime } from '@/lib/format';
import { groupIdeas, reviewHref, roleOf } from '@/lib/ideas-model';
import type { PendingApproval } from '@/lib/types';
import { can, pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';
import CoachMark from '@/components/onboarding/CoachMark';
import { GOALS, isPostGoal } from '@/lib/post-goals';

export const dynamic = 'force-dynamic';

function DbHint({ message }: { message: string }) {
  return (
    <div className="card border-warning/30 bg-warning/10 text-sm text-warning">
      <p className="font-medium">Banco não acessível ainda</p>
      <p className="mt-1 text-warning">{message}</p>
      <p className="mt-2 text-warning">
        Aplique a migration <code>supabase/migrations/0002_platform_scheduling.sql</code> e confira{' '}
        <code>SUPABASE_URL</code> / <code>SUPABASE_SERVICE_KEY</code>.
      </p>
    </div>
  );
}

// O objetivo do post (SPEC 017 decisão 6) e o formato, gravados na semente da pendência.
const goalLabel = (seed: Record<string, unknown> | undefined) => (isPostGoal(seed?.goal) && seed?.goal !== 'auto' ? GOALS[seed.goal].label : null);
const CHANNEL_NAME: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };
const ratioLabel = (seed: Record<string, unknown> | undefined) => (seed?.ratio === '1:1' ? 'Quadrado 1:1' : 'Retrato 4:5');

export default async function InboxPage() {
  const t = await pageTenant();
  const canCreate = await can('content.create');
  let pendings: PendingApproval[] = [];
  let inProgress: InProgressPost[] = [];
  let err = '';
  try {
    [pendings, inProgress] = await Promise.all([getPendings(t), listInProgress(t)]);
  } catch (e) {
    err = pageError(e, 'page/inbox');
  }

  // Redes da mesma rodada viram um cartão só (SPEC 003 R3); pendência avulsa abre a tela antiga.
  const ideas = groupIdeas(pendings);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Aprovar</h1>
          <p className="text-sm text-muted">Só os posts que esperam a sua aprovação. O aprovado vai para a Agenda; o publicado, para o Histórico.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">
            {pendings.length} para aprovar
          </span>
          {canCreate && (
            <Link href="/criar" className="btn-primary">
              Criar post
            </Link>
          )}
        </div>
      </div>

      <CoachMark id="inbox" title="Aqui ficam os posts para revisar." body="Abra um post, ajuste a legenda se quiser e aprove: ele entra no próximo horário da agenda." />

      {err && <DbHint message={err} />}

      {inProgress.length > 0 && (
        <section className="card space-y-3" aria-label="Posts em criação">
          <h2 className="text-sm font-semibold">Em criação ({inProgress.length})</h2>
          <ul className="divide-y divide-line">
            {inProgress.map((p) => {
              const level = levelOf(p.effort);
              const agent = level.engine === 'studio' ? studioSteps(p.effort, p.stage, 'generating').find((s) => s.state === 'run') : null;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Spinner />
                    <span className="truncate">{p.idea}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-muted">
                    <span>{agent ? `${level.name}: ${agent.title}` : level.name} · {level.engine === 'studio' ? level.time : 'cerca de 1 minuto'}</span>
                    <Link href={`/criar/${p.id}`} className="text-accent-text hover:underline">
                      Acompanhar
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">Quando ficar pronto, o post aparece aqui para você aprovar e o sino avisa.</p>
        </section>
      )}

      {!err && pendings.length === 0 && (
        <div className="card space-y-3 py-8 text-center">
          <h2 className="text-lg font-semibold">Nada para aprovar</h2>
          <p className="mx-auto max-w-md text-sm text-muted">Os posts criados pela Ekoai chegam aqui para você revisar e aprovar.</p>
          {canCreate && (
            <Link href="/criar" className="btn-primary">
              Criar o primeiro post
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {ideas.map((idea) => {
          const lead = idea.pendings[0];
          const top = lead.generation?.variations?.find((v) => v.id === lead.top_id) || lead.generation?.variations?.[0];
          const cover = idea.pendings.flatMap((p) => p.images || []).find((i) => i.url)?.url || null;
          const href = reviewHref(idea);
          return (
            <Link key={idea.key} href={href} className="card flex gap-4 hover:border-line-strong">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-line text-muted">
                  s/ arte
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {lead.post_kind && idea.pendings.length > 1 && idea.pendings.map((p) => <span key={p.pending_id} className="chip">{CHANNEL_NAME[p.channel] ?? p.channel}</span>)}
                  {lead.post_kind && goalLabel(lead.seed) && <span className="chip">{goalLabel(lead.seed)}</span>}
                  {lead.post_kind && <span className="chip">{ratioLabel(lead.seed)}</span>}
                  {!lead.post_kind && idea.pendings.map((p) => (
                    <span key={p.pending_id} className="chip uppercase" title={roleOf(p)}>
                      {p.channel}
                      {roleOf(p) === 'reuse' ? ' (reaproveitado)' : ''}
                    </span>
                  ))}
                  {!lead.post_kind && lead.generation?.pillar && <span className="chip">{lead.generation.pillar}</span>}
                  {!lead.post_kind && lead.generation?.angle && <span className="chip">{lead.generation.angle}</span>}
                  {lead.generation?.guardrail_flags?.length ? <span className="chip border-warning/40 text-warning">Com aviso do revisor</span> : null}
                </div>
                <p className="mt-2 line-clamp-2 font-medium">{top?.hook || '(sem título)'}</p>
                {lead.post_kind && <p className="mt-1 line-clamp-2 text-sm text-muted">{top?.body}</p>}
                <p className="mt-1 text-xs text-muted">recebido {fmtDateTime(lead.saved_at)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
