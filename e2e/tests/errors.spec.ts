import { randomBytes } from 'node:crypto';
import { test, expect } from '../support/test';
import { failFake, resetFakes } from '../support/fakes';
import { saveMinimalProfile } from '../support/flows';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// Caminhos de erro que a pessoa encontra: sem sessão (401), sessão adulterada, página ou item que não
// existe (404), limite de taxa (429) e a geração que falha e se refaz. O texto do erro também é
// conferido: diz o que houve e o que fazer.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

test.describe('sem sessão', () => {
  test('a API responde 401 e a página leva ao login, guardando o destino', async ({ page }) => {
    for (const path of ['/api/posts', '/api/profile', '/api/team/invitations']) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(401);
      expect(await res.json()).toEqual({ error: 'Não autorizado' });
    }
    await page.goto(`/inbox/plat-${UNKNOWN_ID}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Finbox%2Fplat-${UNKNOWN_ID}$`));
  });

  test('cookie de sessão adulterado não vale', async ({ page, context }) => {
    await login(page, 'admin');
    const cookie = (await context.cookies()).find((c) => c.name === 'pa_session');
    expect(cookie).toBeTruthy();
    // troca o fim da assinatura: o servidor recalcula e recusa
    const forged = `${cookie!.value.slice(0, -4)}AAAA`;
    await context.addCookies([{ ...cookie!, value: forged }]);

    expect((await page.request.get('/api/posts/' + UNKNOWN_ID, { maxRedirects: 0 })).status()).toBe(401);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe.serial('com sessão', () => {
  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('o que não existe responde 404, sem vazar detalhe', async ({ page }) => {
    await login(page, 'admin');
    await saveMinimalProfile(page);

    expect((await page.goto('/nao-existe'))?.status()).toBe(404);
    await expect(page.getByText('Página ou pendência não encontrada.')).toBeVisible();
    expect((await page.goto(`/inbox/plat-${UNKNOWN_ID}`))?.status()).toBe(404);

    const post = await page.request.get(`/api/posts/${UNKNOWN_ID}`);
    expect(post.status()).toBe(404);
    expect(await post.json()).toEqual({ error: 'Pedido não encontrado.' });

    // a mídia é pública por chave com UUID: a que não existe é 404 seco, e a fora do formato nem chega ao bucket
    const missing = await page.request.get(`/api/media/images/${UNKNOWN_ID}.png`);
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toBe('Não encontrado');
    for (const key of ['images/nao-e-uuid.png', 'documents/x.exe', '..%2F..%2Fetc%2Fpasswd']) {
      expect((await page.request.get(`/api/media/${key}`)).status(), key).toBe(404);
    }
  });

  // BUG conhecido do app, fora desta frente (BEZ-273): `notFound()` dentro do try da página vira um
  // cartão de erro com status 200 e uma linha de erro no log. Quando for corrigido, tire o `fixme`.
  test.fixme('pedido de post que não existe responde 404', async ({ page }) => {
    await login(page, 'admin');
    expect((await page.goto(`/create/${UNKNOWN_ID}`))?.status()).toBe(404);
  });

  test('o limite de taxa responde 429 com o tempo de espera, e conta por IP', async ({ page }) => {
    // /api/invitations/accept é pública e tem teto de 30 por hora por IP (o limite vem antes de olhar o
    // corpo, então tentativa inválida também conta). Um IP novo por rodada: o contador mora no banco e
    // sobrevive entre os projetos (desktop e mobile).
    const ip = `2001:db8::${randomBytes(4).toString('hex')}`;
    const call = (address = ip) => page.request.post('/api/invitations/accept', { headers: { 'x-forwarded-for': address }, data: {} });

    for (let i = 0; i < 30; i += 1) expect((await call()).status(), `tentativa ${i + 1}`).toBe(400);
    const blocked = await call();
    expect(blocked.status()).toBe(429);
    expect(blocked.headers()['retry-after']).toMatch(/^\d+$/);
    expect(await blocked.json()).toMatchObject({ code: 'rate_limited', error: expect.stringMatching(/^Muitas tentativas seguidas\. Tente de novo em /) });

    // outro IP não é afetado
    expect((await call(`2001:db8::${randomBytes(4).toString('hex')}`)).status()).toBe(400);
  });

  test('a geração falha, a tela diz o que fazer e "Tentar de novo" refaz', async ({ page }) => {
    await login(page, 'admin');
    await failFake('aiplatform.googleapis.com', 400, 1);

    await page.goto('/create');
    await page.getByRole('textbox', { name: 'Descreva o que você quer no post' }).fill('bolo de cenoura da semana');
    await page.getByRole('button', { name: 'Criar post', exact: true }).click();

    await expect(page.getByText('Não deu para gerar o post.')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Essa falha não conta no limite do mês/)).toBeVisible();

    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('O post está pronto.')).toBeVisible({ timeout: 90_000 });
  });
});
