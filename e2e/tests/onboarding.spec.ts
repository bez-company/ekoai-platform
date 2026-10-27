import { expect, test } from '../support/test';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// Os dois testes dependem um do outro (o segundo confere o que o primeiro gravou) e mudam o estado da
// conta: rodam em ordem, partindo de uma conta nova a cada projeto (desktop e mobile).
test.describe.serial('onboarding da conta nova', () => {
  test.beforeAll(resetAccount);

  test('administrador preenche o perfil em passos e chega às perguntas rápidas', async ({ page }) => {
    await login(page, 'admin');

    // conta nova: o Início guia, e o perfil é o primeiro passo
    await expect(page.getByText('Perfil da empresa', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Preencher perfil' }).click();
    await expect(page).toHaveURL(/\/boas-vindas$/);
    await expect(page.getByRole('heading', { name: 'Conte sobre o negócio' })).toBeVisible();

    // o passo Negócio é obrigatório: sem preencher, não avança e diz o que falta
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Corrija os campos marcados para continuar.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Conte sobre o negócio' })).toBeVisible();

    await page.getByLabel('Nicho').click();
    await page.getByRole('option').first().click();
    await page.getByLabel('O que a empresa vende').fill('Bolos e doces para festas, com entrega no mesmo dia.');
    await page.getByLabel('Para quem vende').fill('Famílias que organizam aniversários na região.');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // os dois passos seguintes são opcionais
    await expect(page.getByRole('heading', { name: 'Como a marca fala' })).toBeVisible();
    await page.getByRole('button', { name: 'Pular por agora' }).click();
    await expect(page.getByRole('heading', { name: 'Visual da marca' })).toBeVisible();
    await page.getByRole('button', { name: 'Concluir' }).click();

    await expect(page).toHaveURL(/\/boas-vindas\/perguntas$/);
  });

  test('o perfil gravado vale na volta: o onboarding não reabre', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/boas-vindas');
    await expect(page).toHaveURL((url) => url.pathname === '/inicio');
  });
});
