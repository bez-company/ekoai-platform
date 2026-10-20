import Nav from '@/components/Nav';
import Link from 'next/link';
import { countByStatus } from '@/lib/queries';
import { getPauseState, type PauseState } from '@/lib/pause';
import { fmtDateTime } from '@/lib/format';
import NoticeBell from '@/components/NoticeBell';
import { accountOf } from '@/lib/accounts';
import { noticeWhen, toneOf } from '@/lib/notice-view';
import { listNotices, unreadCount } from '@/lib/notifications';
import { can, pageSession } from '@/lib/session';
import { SCREENS, screensFor } from '@/lib/screens';
import type { Permission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { t, role, user } = await pageSession();
  const permissions = [...new Set(SCREENS.map((s) => s.permission))];
  const granted = new Set<Permission>((await Promise.all(permissions.map(async (p) => ((await can(p)) ? p : null)))).filter((p): p is Permission => p !== null));
  const links = screensFor((p) => granted.has(p));
  let badges = { pendings: 0, failed: 0 };
  let pause: PauseState | null = null;
  try {
    const [c, p] = await Promise.all([countByStatus(t), getPauseState(t)]);
    badges = { pendings: c.pendings, failed: c.failed };
    pause = p;
  } catch {
    // sem DB ainda (migration não aplicada) — segue sem badges
  }
  // Sino e nome da conta na barra de cima. Falha ao ler avisos não derruba a tela.
  let accountName = '';
  let bell = <NoticeBell notices={[]} unread={0} />;
  try {
    const [account, rows, unread] = await Promise.all([accountOf(t.tenantId), listNotices(t, role, user?.id ?? null, 5), unreadCount(t, role, user?.id ?? null)]);
    accountName = account?.name ?? '';
    const now = Date.now();
    bell = <NoticeBell unread={unread} notices={rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, tone: toneOf(n.level), unread: n.unread, when: noticeWhen(n.createdAt, now) }))} />;
  } catch {
    // sem DB ainda (migration não aplicada): segue sem avisos
  }
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <Nav links={links} badges={badges} bell={bell} />
      <div className="min-w-0 pb-24 md:pb-0">
        <header className="sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-line bg-page/90 px-8 backdrop-blur md:flex">
          <span className="truncate text-sm font-semibold">{accountName}</span>
          <span className="flex-1" />
          {bell}
        </header>
        {pause?.paused && (
          <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-center text-sm text-fg" role="status">
            Publicação pausada{pause.pausedAt ? ` desde ${fmtDateTime(pause.pausedAt)}` : ''}.{' '}
            {granted.has('profile.view') ? (
              <>
                Nada sai até você retomar.{' '}
                <Link href="/settings" className="font-semibold text-accent-text underline underline-offset-2">
                  Retomar em Configurações
                </Link>
              </>
            ) : (
              'Nada sai até um administrador retomar.'
            )}
          </div>
        )}
        <main className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
