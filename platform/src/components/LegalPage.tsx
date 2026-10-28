import Link from 'next/link';
import Logo from './Logo';
import { LEGAL_UPDATED_LABEL } from '@/lib/legal';

// Moldura dos textos legais (Termos de uso e Política de privacidade): páginas públicas, só leitura, no mesmo
// tom visual da entrada. O conteúdo de cada documento fica na própria página.
export function LegalPage({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/entrar" aria-label="Ekoai, ir para a entrada">
            <Logo className="text-xl" />
          </Link>
          <Link href="/entrar" className="link text-sm">
            Entrar
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">Versão de {LEGAL_UPDATED_LABEL}</p>
        <p className="mt-6 leading-relaxed">{lead}</p>
        <div className="mt-2">{children}</div>
      </main>
      <footer className="border-t border-line">
        <nav aria-label="Textos legais" className="mx-auto flex max-w-3xl gap-4 px-4 py-6 text-sm">
          <Link href="/termos" className="link">
            Termos de uso
          </Link>
          <Link href="/privacidade" className="link">
            Política de privacidade
          </Link>
        </nav>
      </footer>
    </div>
  );
}

export function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9" aria-labelledby={`s${n}`}>
      <h2 id={`s${n}`} className="text-lg font-semibold">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}
