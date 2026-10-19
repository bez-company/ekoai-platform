'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/calendar', label: 'Agenda' },
  { href: '/history', label: 'Histórico' },
  { href: '/learning', label: 'Aprendizado' },
  { href: '/settings', label: 'Slots' },
];

export default function Nav({ badges }: { badges?: { pendings?: number; failed?: number } }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-edge bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3">
        <span className="mr-4 text-sm font-semibold tracking-tight">📋 Cockpit</span>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname?.startsWith(l.href);
            const badge =
              l.href === '/inbox' ? badges?.pendings : l.href === '/calendar' ? badges?.failed : undefined;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  active ? 'bg-panel text-white' : 'text-muted hover:text-white'
                }`}
              >
                {l.label}
                {badge ? (
                  <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="btn-ghost ml-auto px-2 py-1 text-xs">
          Sair
        </button>
      </div>
    </header>
  );
}
