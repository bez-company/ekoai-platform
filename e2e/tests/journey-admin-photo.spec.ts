import { test, expect } from '../support/test';
import { makeScheduledPostsDue } from '../support/db';
import { cronSecret } from '../support/env';
import { fakeCalls, resetFakes } from '../support/fakes';
import { expectInCalendar, pngSize, readyToPublish } from '../support/flows';
import { testPhoto } from '../support/images';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// A jornada da foto sem IA (SPEC 017, decisão 10): foto no banco de imagens, corte, legenda, agenda e
// publicação. A IA só descreve a foto e sugere a legenda (Vertex simulado); a imagem que sai é a foto
// da empresa, cortada pelo app. Os passos dependem uns dos outros e rodam em ordem, de uma conta nova.
const CAPTION = 'Cenoura com chocolate, do forno para a sua mesa. Encomende pelo WhatsApp.';
const EDITED = `${CAPTION} Retirada às sextas.`;

test.describe.serial('administrador: foto sem IA até a publicação', () => {
  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('prepara a conta e sobe a foto no banco de imagens', async ({ page }) => {
    await login(page, 'admin');
    await test.step('conta pronta para publicar', () => readyToPublish(page));

    await test.step('sobe a foto e a Ekoai a descreve olhando a imagem', async () => {
      await page.goto('/midia');
      await page.locator('input[type=file]').first().setInputFiles({ name: 'bolo.png', mimeType: 'image/png', buffer: testPhoto() });
      await expect(page.getByText(/Descrita: "Bolo de cenoura/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Todas (1)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Não usadas (1)' })).toBeVisible();

      const vision = (await fakeCalls(/aiplatform/)).filter((c) => JSON.stringify(c.body).includes('media_describe'));
      expect(vision).toHaveLength(1);
      // a foto foi junto da chamada (a visão olha a imagem, não só o nome do arquivo)
      expect(JSON.stringify(vision[0].body)).toContain('inlineData');
    });
  });

  test('escolhe a foto, corta, aceita a legenda da Ekoai, ajusta e agenda', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/foto');

    await test.step('escolhe do banco e corta em quadrado', async () => {
      await page.getByRole('option', { name: /Bolo de cenoura/ }).getByRole('button').click();
      await expect(page.getByText(/Do banco de imagens · 800 × 600 px/)).toBeVisible();
      await page.getByRole('radio', { name: 'Quadrado 1:1' }).check();
      await expect(page.getByRole('img', { name: 'Imagem do post' })).toBeVisible();
    });

    await test.step('a legenda vem da Ekoai, olhando a foto, e a pessoa ajusta', async () => {
      const caption = page.getByRole('textbox', { name: 'Texto da legenda' });
      await expect(caption).toHaveValue(CAPTION);
      await expect(page.getByRole('textbox', { name: /Hashtags/ })).toHaveValue('#bolodecenoura #confeitaria');
      await caption.fill(EDITED);
    });

    await test.step('agenda no próximo horário livre', async () => {
      await expect(page.getByRole('radio', { name: /Próximo horário livre/ })).toBeChecked();
      await page.getByRole('button', { name: /^Agendar/ }).click();
      await expect(page.getByRole('heading', { name: /^Agendado para/ })).toBeVisible();
      await expectInCalendar(page, /Agendado\. Cenoura com chocolate/);
    });
  });

  test('o horário chega, o cron publica a foto cortada e o banco marca como usada', async ({ page }) => {
    await login(page, 'admin');

    await test.step('o cron publica', async () => {
      expect(await makeScheduledPostsDue()).toBe(1);
      const res = await page.request.post('/api/cron/publish-due', { headers: { authorization: `Bearer ${cronSecret()}` } });
      expect(await res.json()).toMatchObject({ ok: true, picked: 1, published: 1, failed: 0 });
    });

    await test.step('a Meta recebeu a foto cortada em 1080x1080 e a legenda ajustada', async () => {
      const meta = await fakeCalls(/graph\.instagram\.com/);
      const created = meta.find((c) => c.method === 'POST' && c.path.endsWith('/media'));
      expect(created).toBeTruthy();
      const body = created!.body as { image_url?: string; caption?: string };
      expect(body.caption).toContain(EDITED);
      expect(body.caption).toContain('#bolodecenoura');

      // a Meta busca a imagem pela URL pública do app: confere o que ela encontraria
      const image = await page.request.get(new URL(body.image_url!).pathname);
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toBe('image/png');
      expect(pngSize(await image.body())).toEqual({ width: 1080, height: 1080 });
    });

    await test.step('histórico e banco de imagens refletem a publicação', async () => {
      await page.goto('/historico');
      await expect(page.getByText('1 post publicado')).toBeVisible();
      await page.goto('/midia');
      await expect(page.getByRole('button', { name: 'Usadas (1)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Não usadas (0)' })).toBeVisible();
    });
  });
});
