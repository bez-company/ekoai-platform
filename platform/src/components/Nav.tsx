'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from './Logo';

// Barra lateral em ameixa (data-theme="dark") mesmo no tema claro, como no protótipo da fase 1.
// No celular vira barra superior com o logo e barra inferior com os itens.
const ICONS: Record<string, string> = {
  inbox: 'M4 4h16v10h-5l-1.5 3h-3L9 14H4zM4 14v6h16v-6',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

const LINKS = [
  { href: '/inbox', label: 'Aprovar', icon: 'inbox' },
  { href: '/calendar', label: 'Agenda', icon: 'calendar' },
  { href: '/history', label: 'Publicados', icon: 'chart' },
  { href: '/learning', label: 'Aprendizado', icon: 'spark' },
  { href: '/settings', label: 'Configurações', icon: 'settings' },
];

function Icon({ name }: { name: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export default function Nav({ badges }: { badges?: { pendings?: number; failed?: number } }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const badgeFor = (href: string) => (href === '/inbox' ? badges?.pendings : href === '/calendar' ? badges?.failed : undefined);

  return (
    <>
      <aside
        data-theme="dark"
        aria-label="Menu"
        className="sticky top-0 hidden h-screen flex-col gap-1 bg-surface px-3 py-5 text-fg md:flex"
      >
        <Link href="/inbox" className="mb-5 px-2.5 text-xl">
          <Logo />
        </Link>
        <nav className="flex flex-col gap-1">
          {LINKS.map((l) => {
            const active = pathname?.startsWith(l.href);
            const badge = badgeFor(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
                  active ? 'bg-accent/15 font-semibold text-accent-text' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <Icon name={l.icon} />
                {l.label}
                {badge ? (
                  <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-on-accent">{badge}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="mt-auto rounded-md px-2.5 py-2 text-left text-sm text-muted transition hover:bg-raised hover:text-fg">
          Sair
        </button>
      </aside>

      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
        <Logo className="text-lg" />
        <button onClick={logout} className="text-sm font-semibold text-muted">
          Sair
        </button>
      </header>

      <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface px-1 pb-2 pt-1.5 md:hidden">
        {LINKS.map((l) => {
          const active = pathname?.startsWith(l.href);
          const badge = badgeFor(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'font-bold text-accent-text' : 'text-muted'}`}
            >
              <Icon name={l.icon} />
              {l.label === 'Configurações' ? 'Ajustes' : l.label}
              {badge ? <span className="absolute right-3 top-0.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent">{badge}</span> : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
