import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, password, type Persona } from './env';

// Entra pela tela de login, como a pessoa faria. O login por pessoa troca o ID token do emulador
// por um cookie de sessão; terminar na URL de destino prova que o par funcionou.
export async function login(page: Page, persona: Persona, next = '/inicio') {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await page.getByLabel('E-mail').fill(ACCOUNTS[persona].email);
  await page.getByLabel('Senha').fill(password());
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL((url) => url.pathname === next);
}

// No desktop o botão fica na lateral; no celular, dentro do menu "Mais".
export async function logout(page: Page) {
  const more = page.getByRole('button', { name: 'Mais', exact: true });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole('dialog', { name: 'Mais opções' }).getByRole('button', { name: 'Sair' }).click();
  } else {
    await page.getByRole('button', { name: 'Sair da conta' }).click();
  }
}
