import { expect, test } from '../support/test';
import { ACCOUNTS } from '../support/env';
import { login, logout } from '../support/session';

test.describe('login', () => {
  test('quem não entrou é levado ao login e volta para onde ia', async ({ page }) => {
    await page.goto('/settings/company');
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fcompany$/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('senha errada mostra o erro e continua no login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(ACCOUNTS.admin.email);
    await page.getByLabel('Senha').fill('senha-que-nao-confere-1');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('E-mail ou senha não conferem')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('administrador entra, vê o Início e sai', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible();

    await logout(page);
    await expect(page).toHaveURL(/\/login/);
    // sem sessão, a área logada volta a pedir login
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
