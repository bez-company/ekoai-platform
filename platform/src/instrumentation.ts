// Gancho do Next: roda uma vez ao subir o servidor. Liga o Sentry só no runtime Node (o
// middleware roda no edge e não leva o SDK) e reporta o erro de qualquer rota ou página.
// O import fica DENTRO do `if` para o webpack descartar o ramo no bundle do edge.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentry } = await import('./lib/sentry');
    initSentry();
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { captureError, flushSentry } = await import('./lib/sentry');
    captureError(error, 'next', {
      path: request.path.split('?')[0],
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
    });
    await flushSentry();
  }
}
