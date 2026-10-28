import type { Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { resetFakes } from '../support/fakes';
import { expectInCalendar, readyToPublish } from '../support/flows';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// A jornada do carrossel (SPEC 023, BEZ-338): criar com o formato Carrossel, ver as lâminas em Aprovar, ajustar uma no Studio,
// trocar para uma imagem e voltar, aprovar e ver o post agendado. Modelo e Meta são simulados (support/fakes.ts): o
// redator devolve quatro lâminas; o resto é o app de verdade (o servidor desenha cada lâmina, o banco guarda as versões).
const IDEA = 'três sinais de que o bolo está no ponto';

const slideButtons = (page: Page) => page.getByRole('group', { name: 'Lâminas do carrossel' }).getByRole('button', { name: /^Lâmina \d/ });
const confirmButton = (page: Page) => page.getByRole('button', { name: 'Confirmar', exact: true });

test.describe.serial('Carrossel, do pedido ao agendamento', () => {
  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('cria o carrossel, vê as lâminas, ajusta uma no Studio, troca de formato e agenda', async ({ page }) => {
    await login(page, 'admin');
    await readyToPublish(page);

    await test.step('pede um carrossel e a Ekoai escreve as lâminas', async () => {
      await page.goto('/criar');
      await page.getByRole('radio', { name: /Carrossel/ }).click();
      await expect(page.getByRole('radiogroup', { name: 'Quantidade de lâminas' }).first()).toBeVisible();
      await page.getByRole('textbox', { name: 'Descreva o que você quer no post' }).fill(IDEA);
      await page.getByRole('button', { name: 'Criar post', exact: true }).click();
      await expect(page).toHaveURL(/\/criar\/[0-9a-f-]{36}$/);
      await expect(page.getByText('O post está pronto.')).toBeVisible({ timeout: 90_000 });
      await page.getByRole('link', { name: 'Revisar o post' }).click();
      await expect(page).toHaveURL(/\/aprovar\/plat-/);
    });

    const inbox = new URL(page.url()).pathname;

    await test.step('Aprovar mostra as quatro lâminas e as setas trocam de lâmina', async () => {
      await expect(slideButtons(page)).toHaveCount(4);
      await expect(page.getByRole('img', { name: 'Lâmina 1 de 4' })).toBeVisible();
      await page.getByRole('button', { name: 'Próxima lâmina' }).click();
      await expect(page.getByRole('img', { name: 'Lâmina 2 de 4' })).toBeVisible();
      await page.getByRole('button', { name: 'Lâmina anterior' }).click();
      await expect(page.getByRole('img', { name: 'Lâmina 1 de 4' })).toBeVisible();
    });

    await test.step('o Studio ajusta a lâmina 3 e grava a versão 2', async () => {
      await page.getByRole('link', { name: 'Editar imagem' }).click();
      await expect(page).toHaveURL(/\/studio$/);
      await expect(page.getByRole('application', { name: /Imagem do post/ })).toBeVisible();
      await page.getByRole('group', { name: 'Lâminas do carrossel' }).getByRole('button', { name: 'Lâmina 3', exact: true }).click();
      await page
        .getByRole('option')
        .getByRole('button', { name: 'Título', exact: true })
        .or(page.getByRole('group', { name: 'Elementos' }).getByRole('button', { name: 'Título', exact: true }))
        .first()
        .click();
      await page.getByRole('button', { name: 'Travar', exact: true }).click();
      await confirmButton(page).click();
      await expect(page.getByText(/Salvo como versão 2/)).toBeVisible();
      await page.getByRole('link', { name: /Voltar ao post/ }).click();
      await expect(page.getByText(/Versão 2 em uso/)).toBeVisible();
    });

    await test.step('troca para uma imagem e volta para o carrossel', async () => {
      await page.getByRole('button', { name: 'Trocar para uma imagem', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Trocar para uma imagem', exact: true }).click();
      await expect(page.getByText(/Este post é de uma imagem/)).toBeVisible();
      await expect(slideButtons(page)).toHaveCount(0);

      await page.getByRole('button', { name: 'Transformar em carrossel', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Transformar em carrossel', exact: true }).click();
      await expect(page.getByText(/Este post é um carrossel de 4 lâminas/)).toBeVisible();
      await expect(slideButtons(page)).toHaveCount(4);
    });

    await test.step('aprova e o post sai agendado', async () => {
      await page.goto(inbox);
      await page.getByRole('button', { name: 'Aprovar e agendar' }).click();
      await expect(page).toHaveURL(/\/agenda/);
      await expectInCalendar(page, /Agendado\. Bolo bom não tem pressa/);
    });
  });
});
