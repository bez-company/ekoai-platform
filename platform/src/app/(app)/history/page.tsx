import { getPublishedHistory } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import FeedbackForm from '@/components/FeedbackForm';
import type { PublishedPost } from '@/lib/types';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const t = await pageTenant();
  let posts: PublishedPost[] = [];
  let err = '';
  try {
    posts = await getPublishedHistory(t, 60);
  } catch (e) {
    err = pageError(e, 'page/history');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Histórico</h1>
      {err && <div className="card border-amber-900/50 bg-amber-950/20 text-sm text-amber-200">{err}</div>}
      {!err && posts.length === 0 && <div className="card text-sm text-muted">Nada publicado ainda.</div>}

      <div className="grid gap-2">
        {posts.map((p) => (
          <div key={p.id} className="card space-y-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip uppercase">{p.channel}</span>
                  {p.pillar && <span className="chip">{p.pillar}</span>}
                  {p.angle && <span className="chip">{p.angle}</span>}
                  <span className="chip">{p.format || 'single'}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{p.hook || p.body?.slice(0, 100) || '(sem hook)'}</p>
                <p className="mt-1 text-xs text-muted">{p.published_at ? fmtDateTime(p.published_at) : 'sem data'}</p>
                {p.funnel && p.funnel.cadastros > 0 && (
                  <p className="mt-1 text-xs text-emerald-300">
                    {p.funnel.cadastros} {p.funnel.cadastros === 1 ? 'cadastro' : 'cadastros'} · {p.funnel.ativados}{' '}
                    {p.funnel.ativados === 1 ? 'ativado' : 'ativados'} · {p.funnel.pagantes}{' '}
                    {p.funnel.pagantes === 1 ? 'pagante' : 'pagantes'}
                  </p>
                )}
              </div>
              {p.engagement_score != null && (
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold text-emerald-300">{Number(p.engagement_score).toFixed(2)}</div>
                  <div className="label">engajamento</div>
                </div>
              )}
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted hover:text-white">Dar feedback sobre este post</summary>
              <div className="pt-3">
                <FeedbackForm channel={p.channel} postId={p.id} excerpt={p.hook || p.body?.slice(0, 100)} />
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
