// origin.ts: endereço público da plataforma, para montar o link do convite. Em produção vem de
// APP_BASE_URL (o Cloud Run enxerga o endereço interno); sem ela, usa os cabeçalhos do proxy.

export function appOrigin(req: Request, env: Record<string, string | undefined> = process.env): string {
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
