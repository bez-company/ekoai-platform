import Link from 'next/link';

// Publicados tem duas abas: a grade de posts e a análise (SPEC 022). Cada uma é uma rota, então o link
// funciona sem JavaScript e a aba certa fica marcada ao recarregar.
export default function PublishedTabs({ active }: { active: 'posts' | 'analytics' }) {
  const tabs = [
    { id: 'posts', href: '/historico', label: 'Posts' },
    { id: 'analytics', href: '/historico/analise', label: 'Analytics' },
  ] as const;
  return (
    <nav aria-label="Seção de Publicados" className="flex gap-2">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === active ? 'page' : undefined} className={`rounded-full border px-3.5 py-1.5 text-sm ${t.id === active ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-raised text-fg hover:bg-inset'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
