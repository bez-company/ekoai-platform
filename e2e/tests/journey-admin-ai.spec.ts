import { test, expect } from '../support/test';
import { makeScheduledPostsDue } from '../support/db';
import { cronSecret } from '../support/env';
import { fakeCalls, resetFakes } from '../support/fakes';
import { connectInstagram, expectInCalendar, pickRhythm, resumePublishing, saveMinimalProfile } from '../support/flows';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// A jornada do administrador até a primeira publicação, com o post feito pela IA. Vertex, Cloud KMS e
// Meta são simulados (support/fakes.ts); o resto é o app de verdade: o navegador, o servidor, o banco,
// o worker de geração e o cron de publicação. Os passos dependem uns dos outros, então rodam em ordem,
// de uma conta nova, em cada projeto (desktop e mobile).
const IDEA = 'como saber se o bolo está pronto';
const EDITED_CAPTION = 'Legenda editada no teste. Chame no WhatsApp.';

test.describe.serial('administrador: da conta nova à primeira publicação (post por IA)', () => {
  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('perfil, Instagram, publicação e horários', async ({ page }) => {
    await login(page, 'admin');
    await test.step('perfil mínimo', () => saveMinimalProfile(page));
    await test.step('conecta o Instagram (Meta simulada)', () => connectInstagram(page));
    await test.step('retoma a publicação, que nasce pausada', () => resumePublishing(page));
    await test.step('escolhe o ritmo de publicação', () => pickRhythm(page));
  });

  test('pede o post, o worker gera, edita e aprova', async ({ page }) => {
    await login(page, 'admin');

    await test.step('pede o post', async () => {
      await page.goto('/create');
      await page.getByRole('textbox', { name: 'Descreva o que você quer no post' }).fill(IDEA);
      await page.getByRole('button', { name: 'Criar post', exact: true }).click();
      await expect(page).toHaveURL(/\/create\/[0-9a-f-]{36}$/);
    });

    await test.step('o worker gera e o post fica pronto para revisar', async () => {
      await expect(page.getByText('O post está pronto.')).toBeVisible({ timeout: 90_000 });
      const model = await fakeCalls(/aiplatform/);
      expect(model.length).toBeGreaterThan(0);
      expect(JSON.stringify(model[0].body)).toContain(IDEA);
      await page.getByRole('link', { name: 'Revisar o post' }).click();
      await expect(page).toHaveURL(/\/inbox\/plat-/);
    });

    await test.step('revisa: a arte carrega e a legenda vem do modelo', async () => {
      await expect(page.getByRole('heading', { name: 'Seu bolo está pronto?', level: 1 })).toBeVisible();
      const image = page.getByRole('img', { name: 'Imagem do post' });
      await expect(image).toBeVisible();
      // a arte saiu do render do app e foi lida de volta pela rota de mídia
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      await expect(page.getByRole('textbox', { name: 'Texto da legenda' })).toHaveValue(/Bolo bom não tem pressa/);
    });

    await test.step('edita a legenda e as hashtags, e aprova', async () => {
      await page.getByRole('textbox', { name: 'Texto da legenda' }).fill(EDITED_CAPTION);
      const hashtag = page.getByRole('textbox', { name: 'Nova hashtag' });
      await hashtag.fill('confeitaria');
      await hashtag.press('Enter');
      await expect(page.getByRole('button', { name: 'Remover #confeitaria' })).toBeVisible();
      await page.getByRole('button', { name: 'Aprovar e agendar' }).click();
      await expect(page).toHaveURL(/\/calendar/);
      await expectInCalendar(page, /Agendado\. Legenda editada no teste/);
    });
  });

  test('o horário chega, o cron publica e o post vai ao histórico', async ({ page }) => {
    await login(page, 'admin');

    await test.step('o horário chega e o cron publica', async () => {
      expect(await makeScheduledPostsDue()).toBe(1);
      const res = await page.request.post('/api/cron/publish-due', { headers: { authorization: `Bearer ${cronSecret()}` } });
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, picked: 1, published: 1, failed: 0 });
    });

    await test.step('a Meta recebeu a arte e a legenda editada', async () => {
      const meta = await fakeCalls(/graph\.instagram\.com/);
      const created = meta.find((c) => c.method === 'POST' && c.path.endsWith('/media'));
      expect(created).toBeTruthy();
      const body = created!.body as { image_url?: string; caption?: string };
      expect(body.image_url).toMatch(/\/api\/media\/images\/[0-9a-f-]+\.png$/);
      expect(body.caption).toContain(EDITED_CAPTION);
      expect(body.caption).toContain('#confeitaria');
      expect(meta.some((c) => c.method === 'POST' && c.path.endsWith('/media_publish'))).toBe(true);
    });

    await test.step('o histórico mostra o post publicado', async () => {
      await page.goto('/history');
      await expect(page.getByText('1 post publicado')).toBeVisible();
      await expect(page.getByRole('link', { name: /Seu bolo está pronto\?, publicado/ })).toBeVisible();
      await page.goto('/calendar');
      await expect(page.getByRole('button', { name: /Publicado\. Legenda editada no teste/ })).toBeVisible();
    });
  });
});
