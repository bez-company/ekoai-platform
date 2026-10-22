import Link from 'next/link';
import { getScheduled } from '@/lib/queries';
import { fmtDate, fmtTime } from '@/lib/format';
import ScheduledCard from '@/components/ScheduledCard';
import type { ScheduledPost } from '@/lib/types';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

const QUEUE = 'Na fila, sem horário';

export default async function CalendarPage() {
  const t = await pageTenant();
  let posts: ScheduledPost[] = [];
  let err = '';
  try {
    posts = await getScheduled(t, ['queued', 'scheduled', 'publishing', 'failed']);
  } catch (e) {
    err = pageError(e, 'page/calendar');
  }

  // A fila sem horário vem primeiro; o resto agrupa por dia (no fuso editorial).
  const groups = new Map<string, ScheduledPost[]>();
  const queued = posts.filter((p) => !p.scheduled_for);
  if (queued.length) groups.set(QUEUE, queued);
  for (const p of posts) {
    if (!p.scheduled_for) continue;
    const key = fmtDate(p.scheduled_for);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const failed = posts.filter((p) => p.status === 'failed');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agenda</h1>
          <p className="text-sm text-muted">Posts aprovados, esperando a hora de publicar. Os publicados ficam no Histórico.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{posts.length} na agenda</span>
          <Link href="/settings#horarios" className="btn-ghost">
            Horários de publicação
          </Link>
        </div>
      </div>

      {err && (
        <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>
      )}

      {queued.length > 0 && (
        <div className="card border-warning/30 bg-warning/10 text-sm">
          {queued.length === 1 ? '1 post aprovado espera' : `${queued.length} posts aprovados esperam`} horário. Crie horários de publicação para eles entrarem na agenda, ou publique agora.
        </div>
      )}

      {failed.length > 0 && (
        <div className="card border-danger/30 bg-danger/10 text-sm text-danger">
          {failed.length === 1 ? '1 post não foi publicado.' : `${failed.length} posts não foram publicados.`} Veja o motivo abaixo e tente de novo.
        </div>
      )}

      {!err && posts.length === 0 && (
        <div className="card space-y-3 py-8 text-center">
          <h2 className="text-lg font-semibold">Nada na agenda</h2>
          <p className="mx-auto max-w-md text-sm text-muted">O post que você aprova entra aqui, no próximo horário de publicação.</p>
          <Link href="/inbox" className="btn-primary">
            Ver posts para aprovar
          </Link>
        </div>
      )}

      <div className="space-y-6">
        {[...groups.entries()].map(([day, items]) => (
          <div key={day} className="space-y-2">
            <h2 className="label">{day}</h2>
            <div className="grid gap-2">
              {items.map((p) => (
                <ScheduledCard key={p.id} post={p} time={p.scheduled_for ? fmtTime(p.scheduled_for) : 'sem horário'} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
