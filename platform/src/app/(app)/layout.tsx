import Nav from '@/components/Nav';
import Link from 'next/link';
import { countByStatus } from '@/lib/queries';
import { getPauseState, type PauseState } from '@/lib/pause';
import { fmtDateTime } from '@/lib/format';
import NoticeBell from '@/components/NoticeBell';
import type { NoticeView } from '@/components/NoticeItem';
import { accountOf, personProfiles } from '@/lib/accounts';
import { noticeWhen, toneOf } from '@/lib/notice-view';
import { listNotices, unreadCount } from '@/lib/notifications';
import { TIER_NAME, tierOf } from '@/lib/account-plan-model';
import { ROLE_COPY } from '@/lib/auth-flow';
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
  // Sino, conta e pessoa na barra lateral (SPEC 017: sem header). Falha ao ler avisos não derruba a tela.
  let account: { name: string; detail: string } | null = null;
  let notices: NoticeView[] = [];
  let unread = 0;
  try {
    const [acct, rows, count] = await Promise.all([accountOf(t.tenantId), listNotices(t, role, user?.id ?? null, 5), unreadCount(t, role, user?.id ?? null)]);
    if (acct) account = { name: acct.name, detail: role === 'viewer' ? 'Você acompanha como leitor' : `Plano ${TIER_NAME[tierOf(acct.kind)]}` };
    const now = Date.now();
    notices = rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, tone: toneOf(n.level), unread: n.unread, when: noticeWhen(n.createdAt, now) }));
    unread = count;
  } catch {
    // sem DB ainda (migration não aplicada): segue sem avisos
  }
  // Sem nome cadastrado, o e-mail ocupa o lugar dele: a pessoa sempre tem como abrir Seu perfil.
  let personName = user?.name ?? null;
  if (user && !personName) {
    try {
      personName = (await personProfiles([user.id])).get(user.id)?.email ?? null;
    } catch {
      personName = null;
    }
  }
  const person = personName ? { name: personName, role: ROLE_COPY[role].label } : null;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <Nav
        links={links}
        badges={badges}
        account={account}
        person={person}
        canCreate={granted.has('content.create')}
        bellSide={<NoticeBell key="side" notices={notices} unread={unread} placement="side" />}
        bellTop={<NoticeBell key="top" notices={notices} unread={unread} />}
      />
      <div className="min-w-0 pb-24 md:pb-0">
        {pause?.paused && (
          <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-center text-sm text-fg" role="status">
            Publicação pausada{pause.pausedAt ? ` desde ${fmtDateTime(pause.pausedAt)}` : ''}.{' '}
            {granted.has('profile.view') ? (
              <>
                Nada sai até você retomar.{' '}
                <Link href="/configuracoes" className="font-semibold text-accent-text underline underline-offset-2">
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
