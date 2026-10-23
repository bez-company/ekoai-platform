import Link from 'next/link';
import Logo from '@/components/Logo';
import { pageConsole } from '@/lib/platform-admin';

export const dynamic = 'force-dynamic';

// Casca do console do administrador da plataforma (BEZ-303). Fora do menu das contas: endereço próprio,
// faixa de aviso e só desktop. O portão fecha com 404 para qualquer pessoa que não seja a administradora.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user } = await pageConsole();
  const initials =
    (user.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'EK';
  return (
    <div className="min-h-screen">
      <div className="flex items-center gap-2.5 bg-ink px-6 py-2 text-[13px] text-paper">
        <b className="rounded bg-accent px-2 py-0.5 text-xs text-on-accent">Console interno</b>
        Ações aqui afetam contas de clientes. Tudo fica no registro de auditoria.
      </div>
      <header className="flex items-center gap-4 border-b border-line bg-surface px-6 py-3.5">
        <Link href="/console" className="text-lg" aria-label="Ekoai, console: ir para as contas">
          <Logo />
        </Link>
        <span className="text-sm text-muted">Console</span>
        <span className="flex-1" />
        <Link href="/console" className="rounded-md px-3 py-1.5 text-sm font-semibold hover:bg-inset">
          Contas
        </Link>
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-inset text-xs font-bold">
          {initials}
        </span>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
