import { test, expect } from '../support/test';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// BEZ-327: numa conta sem nenhum horário, o botão do topo e o aviso "Escolha quando publicar" abriam, os dois, o diálogo
// de Horários pela mesma URL e a pessoa via dois sobrepostos. Agora abre um só.
test.describe.serial('Agenda sem horários', () => {
  test.beforeAll(async () => {
    await resetAccount();
  });

  test('abre um único diálogo de Horários, pela URL e pelo botão do aviso', async ({ page }) => {
    await login(page, 'admin', '/agenda');
    await expect(page.getByRole('heading', { name: 'Escolha quando publicar' })).toBeVisible();

    await page.getByRole('button', { name: 'Escolher horários' }).click();
    await expect(page).toHaveURL(/edit=slots/);
    await expect(page.getByRole('dialog', { name: 'Horários de publicação' })).toHaveCount(1);

    await page.goto('/agenda?edit=slots');
    await expect(page.getByRole('dialog', { name: 'Horários de publicação' })).toHaveCount(1);
  });
});
