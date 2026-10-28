// Gate global: toda rota exige sessão válida (assinatura e validade; a membership é conferida
// no servidor, em session.ts), exceto login, criar conta, o endpoint do cron
// (token OIDC do Scheduler ou CRON_SECRET), o health check e o live, a mídia (chave com UUID; as redes a buscam ao
// publicar) e assets estáticos.

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

// `/instagram/exclusao/` é a página de status do pedido de exclusão que a Meta mostra para a pessoa: só lê pelo
// código aleatório e não mostra conta nem perfil.
const PUBLIC_PREFIXES = ['/entrar', '/convite', '/api/login', '/api/auth/session', '/api/cron', '/api/health', '/api/media/', '/instagram/exclusao/'];
// `/api/version` só devolve a revisão em execução, para a aba aberta avisar que saiu deploy novo (BEZ-427).
// Caminhos públicos exatos: quem chama ainda não tem sessão (a prova é o ID token). Prefixo não,
// para uma rota futura debaixo deles continuar exigindo sessão.
// `/api/live`, `/api/ambiente` e `/api/ambiente/ligar` são do staging sob demanda (SPEC 016): com o banco
// parado ninguém tem sessão, e as rotas só devolvem o estado ou ligam o banco (que o corte por ociosidade desliga).
// `/api/instagram/deauthorize` e `/api/instagram/data-deletion` são os callbacks da Meta (SPEC 011 R5.4): a prova é
// o signed_request assinado com o segredo do app.
// `/termos` e `/privacidade` são os textos legais (BEZ-32): a pessoa os lê antes de ter conta e a revisão da Meta os abre sem login.
const PUBLIC_EXACT = ['/termos', '/privacidade', '/api/account', '/api/invitations/accept', '/api/live', '/api/version', '/api/ambiente', '/api/ambiente/ligar', '/api/instagram/deauthorize', '/api/instagram/data-deletion'];

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
  url.pathname = '/entrar';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

// O ícone da aba (`/icon.svg`, gerado pelo Next a partir de app/icon.svg) é público: a tela de entrada o pede
// sem sessão, e com o gate ele voltava como redirecionamento para /entrar e a aba ficava sem ícone até o login.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
