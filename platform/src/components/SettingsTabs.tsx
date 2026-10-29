'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type SettingsTab = { href: string; label: string };

// Abas de Configurações. Com uma aba só (quem não administra a equipe) a barra não aparece.
export default function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Seções de configurações" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((tab) => {
        // A aba continua marcada nas páginas de dentro dela (Fatura e uso › um post); a raiz de Configurações só marca a si mesma.
        const current = pathname === tab.href || (tab.href !== '/configuracoes' && pathname.startsWith(`${tab.href}/`));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              current ? 'border-accent-text text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
