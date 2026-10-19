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
  "connect-src 'self'",
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
  serverExternalPackages: ['pg', '@google-cloud/storage', 'firebase-admin'],
  // As artes vêm da rota /api/media (bucket privado); as antigas, do raw.githubusercontent.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'raw.githubusercontent.com' }],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
