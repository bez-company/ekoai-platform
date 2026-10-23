import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-muted">Página ou pendência não encontrada.</p>
      <Link href="/aprovar" className="btn-primary">
        Ir pra Inbox
      </Link>
    </div>
  );
}
