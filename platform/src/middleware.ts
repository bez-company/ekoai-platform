// Gate global: toda rota exige sessão válida (assinatura e validade; a membership é conferida
// no servidor, em session.ts), exceto login, criar conta, o endpoint do cron
// (token OIDC do Scheduler ou CRON_SECRET), o health check, a mídia (chave com UUID; as redes a buscam ao
// publicar) e assets estáticos.

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

const PUBLIC_PREFIXES = ['/login', '/convite', '/api/login', '/api/auth/session', '/api/cron', '/api/health', '/api/media'];
// Caminhos públicos exatos: quem chama ainda não tem sessão (a prova é o ID token). Prefixo não,
// para uma rota futura debaixo deles continuar exigindo sessão.
const PUBLIC_EXACT = ['/api/account', '/api/invitations/accept'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySessionToken(token);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
