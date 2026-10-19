import { getScheduled } from '@/lib/queries';
import { fmtDate, fmtTime } from '@/lib/format';
import ScheduledCard from '@/components/ScheduledCard';
import type { ScheduledPost } from '@/lib/types';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const t = await pageTenant();
  let posts: ScheduledPost[] = [];
  let err = '';
  try {
    posts = await getScheduled(t, ['scheduled', 'publishing', 'failed']);
  } catch (e) {
    err = pageError(e, 'page/calendar');
  }

  // agrupa por dia (no fuso editorial)
  const groups = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const key = fmtDate(p.scheduled_for);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const failed = posts.filter((p) => p.status === 'failed');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <span className="text-sm text-muted">{posts.length} na fila</span>
      </div>

      {err && (
        <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>
      )}

      {failed.length > 0 && (
        <div className="card border-danger/30 bg-danger/10 text-sm text-danger">
          {failed.length} post(s) falharam na publicação — veja abaixo e re-tente.
        </div>
      )}

      {!err && posts.length === 0 && (
        <div className="card text-sm text-muted">Fila vazia. Aprove pendências na Inbox pra agendar.</div>
      )}

      <div className="space-y-6">
        {[...groups.entries()].map(([day, items]) => (
          <div key={day} className="space-y-2">
            <h2 className="label">{day}</h2>
            <div className="grid gap-2">
              {items.map((p) => (
                <ScheduledCard key={p.id} post={p} time={fmtTime(p.scheduled_for)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
