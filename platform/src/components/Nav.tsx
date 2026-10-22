'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Logo from './Logo';
import { isActive, MOBILE_PRIMARY, type Screen } from '@/lib/screens';

// Casca sem header (SPEC 017, decisão 2): no desktop, a barra lateral em ameixa (data-theme="dark"
// mesmo no tema claro) leva o sino, a conta, "Criar post", o menu e a pessoa com "Sair". No celular,
// a barra de cima fica só com o logo e o sino, e a de baixo tem as telas do dia a dia mais "Mais".
const ICONS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  inbox: 'M4 4h16v10h-5l-1.5 3h-3L9 14H4zM4 14v6h16v-6',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 17l-5-5-9 8',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'E';

export type NavAccount = { name: string; detail: string };
export type NavPerson = { name: string; role: string };

export default function Nav({
  links,
  badges,
  bellSide,
  bellTop,
  account,
  person,
  canCreate = false,
}: {
  links: Screen[];
  badges?: { pendings?: number; failed?: number };
  bellSide?: React.ReactNode;
  bellTop?: React.ReactNode;
  account?: NavAccount | null;
  person?: NavPerson | null;
  canCreate?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);

  // Trocar de tela fecha o "Mais".
  useEffect(() => setMore(false), [pathname]);
  useEffect(() => {
    if (!more) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [more]);

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const badgeFor = (href: string) => (href === '/inbox' ? badges?.pendings : href === '/calendar' ? badges?.failed : undefined);
  const creating = pathname?.startsWith('/create') ?? false;
  const primary = links.filter((l) => (MOBILE_PRIMARY as readonly string[]).includes(l.href));
  const rest = links.filter((l) => !(MOBILE_PRIMARY as readonly string[]).includes(l.href));
  const restActive = rest.some((l) => isActive(pathname, l.href));

  return (
    <>
      <aside data-theme="dark" aria-label="Menu" className="sticky top-0 hidden h-screen flex-col gap-1.5 bg-surface px-3 py-5 text-fg md:flex">
        <div className="flex items-center justify-between gap-2 pb-2 pl-2.5">
          <Link href="/" className="text-xl" aria-label="Ekoai, ir para o Início">
            <Logo />
          </Link>
          {bellSide}
        </div>

        {account && (
          <div className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-on-accent">
              {initials(account.name)}
            </span>
            <span className="min-w-0 leading-tight">
              <strong className="block truncate text-[13px]">{account.name}</strong>
              <small className="block truncate text-xs text-muted">{account.detail}</small>
            </span>
          </div>
        )}

        {canCreate && !creating && (
          <Link href="/create" className="btn-primary my-1.5 justify-center">
            <Icon name="plus" size={16} />
            Criar post
          </Link>
        )}

        <nav className="flex flex-col gap-1">
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            const badge = badgeFor(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${active ? 'bg-accent/15 font-semibold text-accent-text' : 'text-muted hover:bg-raised hover:text-fg'}`}
              >
                <Icon name={l.icon} />
                {l.label}
                {badge ? <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-on-accent">{badge}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 border-t border-line pt-3">
          {person && (
            <>
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-bold">
                {initials(person.name)}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <strong className="block truncate text-[13px]">{person.name}</strong>
                <small className="block truncate text-xs text-muted">{person.role}</small>
              </span>
            </>
          )}
          <button
            type="button"
            onClick={logout}
            aria-label="Sair da conta"
            title="Sair"
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted transition hover:bg-raised hover:text-fg ${person ? '' : 'w-full'}`}
          >
            <Icon name="logout" size={18} />
            {person ? null : 'Sair'}
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
        <Link href="/" aria-label="Ekoai, ir para o Início">
          <Logo className="text-lg" />
        </Link>
        {bellTop}
      </header>

      {more && (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setMore(false)}>
          <div
            role="dialog"
            aria-label="Mais opções"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-3 bottom-20 space-y-1 rounded-xl border border-line bg-raised p-2 shadow-lg"
          >
            {account && (
              <p className="truncate px-3 pb-1 pt-2 text-xs text-muted">
                {account.name}
                {person ? ` · ${person.name}` : ''}
              </p>
            )}
            {canCreate && (
              <Link href="/create" className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold text-accent-text hover:bg-inset">
                <Icon name="plus" />
                Criar post
              </Link>
            )}
            {rest.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(pathname, l.href) ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm hover:bg-inset ${isActive(pathname, l.href) ? 'font-semibold text-accent-text' : ''}`}
              >
                <Icon name={l.icon} />
                {l.label}
              </Link>
            ))}
            <button type="button" onClick={logout} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm text-muted hover:bg-inset">
              <Icon name="logout" />
              Sair
            </button>
          </div>
        </div>
      )}

      <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface px-1 pb-2 pt-1.5 md:hidden">
        {primary.map((l) => {
          const active = isActive(pathname, l.href);
          const badge = badgeFor(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'font-bold text-accent-text' : 'text-muted'}`}
            >
              <Icon name={l.icon} />
              {l.label}
              {badge ? <span className="absolute right-3 top-0.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent">{badge}</span> : null}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(!more)}
          aria-expanded={more}
          aria-haspopup="dialog"
          className={`relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${more || restActive ? 'font-bold text-accent-text' : 'text-muted'}`}
        >
          <Icon name="menu" />
          Mais
        </button>
      </nav>
    </>
  );
}
