import MarkNoticesRead from '@/components/MarkNoticesRead';
import NoticeItem from '@/components/NoticeItem';
import { pageError } from '@/lib/api';
import { groupNotices, noticeWhen, toneOf } from '@/lib/notice-view';
import { listNotices } from '@/lib/notifications';
import { pageTenant, requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Avisos da conta, do público do papel de quem abre: o leitor só vê o que é para todos.
export default async function NoticesPage() {
  const t = await pageTenant();
  const { role, user } = await requireSession();
  try {
    const rows = await listNotices(t, role, user?.id ?? null, 100);
    const unread = rows.filter((r) => r.unread).length;
    const now = Date.now();
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Avisos</h1>
            <p className="text-sm text-muted">O que aconteceu na conta e o que precisa de você.</p>
          </div>
          {rows.length > 0 && user && <MarkNoticesRead unread={unread} />}
        </div>
        {rows.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 py-12 text-center">
            <h2 className="text-lg font-semibold">Nenhum aviso</h2>
            <p className="max-w-sm text-sm text-muted">Falhas de publicação, acesso ao Instagram vencendo e mudanças na equipe aparecem aqui.</p>
          </div>
        ) : (
          <div className="card space-y-4">
            {groupNotices(rows, now).map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="label">{g.label}</h2>
                <ul className="divide-y divide-line">
                  {g.items.map((n) => (
                    <NoticeItem key={n.id} n={{ id: n.id, title: n.title, body: n.body, link: n.link, tone: toneOf(n.level), unread: n.unread, when: noticeWhen(n.createdAt, now) }} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/notifications')}</div>;
  }
}
