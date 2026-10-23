// CSP do app. Next injeta scripts inline de hidratação, por isso 'unsafe-inline' em script
// (sem nonce por enquanto); o dev server do Next ainda precisa de 'unsafe-eval'. Imagem e
// vídeo aceitam qualquer https: as artes antigas moram em mais de uma origem.
const isDev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  // Login por pessoa: o Firebase Auth fala com estes dois domínios (entrar, segundo fator e renovar
  // o token). Em desenvolvimento, também com o emulador local.
  `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com${isDev ? ' http://127.0.0.1:* http://localhost:*' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // a plataforma vive numa subpasta do repo; fixa a raiz pro tracing não pegar o lockfile de cima
  outputFileTracingRoot: import.meta.dirname,
  poweredByHeader: false,
  // Imagem para o Cloud Run: servidor autocontido na imagem do container (SPEC 010).
  output: 'standalone',
  // Drivers com código nativo ou carregamento dinâmico ficam fora do bundle.
  serverExternalPackages: ['pg', '@google-cloud/storage', 'firebase-admin', '@sentry/node', '@resvg/resvg-js'],
  // O motor de render (lib/design) lê as fontes da lista curada em runtime: entram na imagem standalone.
  outputFileTracingIncludes: { '/**': ['./fonts/**'] },
  // As artes vêm da rota /api/media (bucket privado); as antigas, do raw.githubusercontent.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'raw.githubusercontent.com' }],
  },
  // As telas ganharam endereço em português. Os antigos seguem valendo: favorito, convite e link de
  // notificação já gravado no banco apontam para eles. A sessão e as permissões são conferidas no destino.
  async redirects() {
    const moved = (from, to) => ({ source: from, destination: to, permanent: true });
    return [
      { source: '/', destination: '/inicio', permanent: false },
      moved('/calendar', '/agenda'),
      moved('/campaigns/new', '/campanhas/nova'),
      moved('/campaigns/:id/edit', '/campanhas/:id/editar'),
      moved('/campaigns/:path*', '/campanhas/:path*'),
      moved('/campaigns', '/campanhas'),
      moved('/create/:path*', '/criar/:path*'),
      moved('/create', '/criar'),
      moved('/engage', '/engajar'),
      moved('/history/:path*', '/historico/:path*'),
      moved('/history', '/historico'),
      moved('/inbox/idea/:briefId', '/aprovar/ideia/:briefId'),
      moved('/inbox/:path*', '/aprovar/:path*'),
      moved('/inbox', '/aprovar'),
      moved('/learning', '/aprendizado'),
      moved('/media', '/midia'),
      moved('/notifications', '/notificacoes'),
      moved('/photo', '/foto'),
      moved('/settings/channels', '/configuracoes/canais'),
      moved('/settings/company', '/configuracoes/empresa'),
      moved('/settings/data', '/configuracoes/dados'),
      moved('/settings/facts', '/configuracoes/fatos'),
      moved('/settings/team', '/configuracoes/equipe'),
      moved('/settings', '/configuracoes'),
      moved('/login', '/entrar'),
      moved('/onboarding/perguntas', '/boas-vindas/perguntas'),
      moved('/onboarding', '/boas-vindas'),
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // O logo é um arquivo enviado por usuário (SVG reescrito, mas ainda assim): quem abrir o endereço
      // direto não executa nada. A regra vem depois da geral para valer no lugar dela.
      {
        source: '/api/brand/logo',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" }],
      },
    ];
  },
};

export default nextConfig;
