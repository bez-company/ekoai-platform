import { test as base, expect } from '@playwright/test';
import { BASE_URL } from './env';

// `test` do E2E: o navegador só fala com o app. A autorização do Instagram é simulada (a pessoa
// "autorizou" e volta para o app com o código e o state); qualquer outro host externo é cortado,
// para nenhum teste tocar a internet nem uma conta real.
export const test = base.extend({
  context: async ({ context }, use) => {
    const app = new URL(BASE_URL);

    await context.route(
      (url) => url.hostname !== app.hostname && url.protocol.startsWith('http'),
      (route) => route.abort('blockedbyclient'),
    );

    // O Playwright não intercepta o destino de um redirect: por isso a simulação fica no início da
    // conexão. O app responde com o redirecionamento à Meta (e o cookie de state); trocamos o destino
    // pelo callback do próprio app, que então fala com a Meta simulada.
    await context.route('**/api/instagram/connect', async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const meta = new URL(response.headers().location ?? '');
      const back = new URL(meta.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', 'codigo-simulado');
      back.searchParams.set('state', meta.searchParams.get('state') ?? '');
      await route.fulfill({ response, status: 302, headers: { ...response.headers(), location: back.toString() } });
    });

    await use(context);
  },
});

export { expect };
