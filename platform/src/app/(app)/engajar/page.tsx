import { listEngagements, listTargets, getEngageSummary, type Engagement, type EngageTarget } from '@/lib/engage';
import { ENGAGE_LIMITS } from '@/lib/engage-model';
import { fmtDateTime } from '@/lib/format';
import EngageForm from '@/components/EngageForm';
import EngageTargets from '@/components/EngageTargets';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<Engagement['status'], string> = {
  rascunho: 'rascunho',
  publicado: 'publicado',
  copiado: 'colado à mão',
  falhou: 'falhou',
};

export default async function EngagePage() {
  const t = await pageTenant();
  let items: Engagement[] = [];
  let targets: EngageTarget[] = [];
  let summary = { postedToday: 0, postedThisWeek: 0 };
  let err = '';
  try {
    [items, targets, summary] = await Promise.all([listEngagements(t, 30), listTargets(t), getEngageSummary(t)]);
  } catch (e) {
    err = pageError(e, 'page/engage');
  }
  const done = items.filter((i) => i.status === 'publicado' || i.status === 'copiado');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Engajamento no LinkedIn</h1>
          <p className="text-sm text-muted">
            Comentar em posts do seu público rende tanto quanto postar. Cada comentário sai só depois do seu clique.
          </p>
        </div>
        <div className="text-right text-sm">
          <p>
            <span className="text-lg font-semibold text-fg">{summary.postedThisWeek}</span>
            <span className="text-muted"> de {ENGAGE_LIMITS.weeklyGoal} nesta semana</span>
          </p>
          <p className="text-xs text-muted">
            hoje {summary.postedToday} de {ENGAGE_LIMITS.dailyCap} pela API
          </p>
        </div>
      </div>
      {err && <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>}

      <EngageForm />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Contas para acompanhar</h2>
        <EngageTargets targets={targets} />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Histórico</h2>
        {done.length === 0 && <div className="card text-sm text-muted">Nenhum comentário ainda.</div>}
        <div className="grid gap-1">
          {items
            .filter((i) => i.status !== 'rascunho')
            .map((i) => (
              <div key={i.id} className="rounded-md border border-line px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span className={`chip ${i.status === 'falhou' ? 'text-danger' : ''}`}>{STATUS_LABEL[i.status]}</span>
                  <span className="chip">{i.kind}</span>
                  {i.target_author && <span>{i.target_author}</span>}
                  <span>{fmtDateTime(i.posted_at || i.created_at)}</span>
                  <a href={i.target_url} target="_blank" rel="noopener" className="ml-auto text-accent-text hover:underline">
                    abrir post
                  </a>
                </p>
                <p className="mt-1">{i.comment_text}</p>
                {i.status === 'falhou' && i.error && <p className="mt-1 line-clamp-2 text-xs text-danger">{i.error}</p>}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
