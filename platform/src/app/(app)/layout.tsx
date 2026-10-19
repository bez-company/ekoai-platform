import Nav from '@/components/Nav';
import Link from 'next/link';
import { countByStatus } from '@/lib/queries';
import { getPauseState, type PauseState } from '@/lib/pause';
import { fmtDateTime } from '@/lib/format';
import { pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await pageTenant();
  let badges = { pendings: 0, failed: 0 };
  let pause: PauseState | null = null;
  try {
    const [c, p] = await Promise.all([countByStatus(t), getPauseState(t)]);
    badges = { pendings: c.pendings, failed: c.failed };
    pause = p;
  } catch {
    // sem DB ainda (migration não aplicada) — segue sem badges
  }
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <Nav badges={badges} />
      <div className="min-w-0 pb-24 md:pb-0">
        {pause?.paused && (
          <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-center text-sm text-fg" role="status">
            Publicação pausada{pause.pausedAt ? ` desde ${fmtDateTime(pause.pausedAt)}` : ''}. Nada sai até você retomar.{' '}
            <Link href="/settings" className="font-semibold text-accent-text underline underline-offset-2">
              Retomar em Configurações
            </Link>
          </div>
        )}
        <main className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
