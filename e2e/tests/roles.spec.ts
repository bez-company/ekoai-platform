import type { Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { resetAccount } from '../support/seed';
import { resetFakes } from '../support/fakes';
import { saveMinimalProfile } from '../support/flows';
import { login } from '../support/session';

// O que cada papel vê e pode fazer (ADR 0007, matriz em role_permissions): a tela esconde, e a API
// recusa mesmo quando alguém chama direto. As duas camadas são conferidas, porque esconder o botão
// sem barrar a rota é o erro que o teste de tela sozinho não pega.
// Itens do menu: o selo de pendências ("Aprovar 1") entra no nome do link.
const navLink = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(`^${name}( \\d+)?$`) });
const FORBIDDEN = 'Seu papel nesta conta não permite essa ação. Peça a um administrador.';

// Rotas de escrita que só o administrador usa.
const ADMIN_ONLY = [
  { method: 'PUT', path: '/api/profile', data: { section: 'about' } },
  { method: 'POST', path: '/api/team/invitations', data: { email: 'novo@e2e.example.test', role: 'viewer' } },
  { method: 'POST', path: '/api/pause', data: {} },
  { method: 'GET', path: '/api/export', data: undefined },
] as const;

test.describe.serial('papéis', () => {
  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('administrador vê a equipe e todos os menus', async ({ page }) => {
    await login(page, 'admin');
    await saveMinimalProfile(page);

    await page.goto('/configuracoes/equipe');
    await expect(page.getByRole('heading', { name: 'Equipe', level: 2 })).toBeVisible();
    await expect(page.getByText('3 de 5 pessoas no plano Inicial')).toBeVisible();
    // as três pessoas do seed, cada uma no seu papel
    await expect(page.getByText('criador@e2e.example.test')).toBeVisible();
    await expect(page.getByText('leitor@e2e.example.test')).toBeVisible();

    if (!(await page.getByRole('button', { name: 'Mais', exact: true }).isVisible())) {
      await expect(navLink(page, 'Banco de imagens')).toBeVisible();
      // Configurações abre pelo menu do nome, no rodapé da barra lateral.
      await expect(navLink(page, 'Configurações')).toHaveCount(0);
      await page.getByRole('button', { name: /^Menu de / }).click();
      await expect(page.getByRole('menuitem', { name: 'Configurações' })).toBeVisible();
    }
  });

  test('criador cria post, mas não mexe em equipe, perfil, pausa nem exportação', async ({ page }) => {
    await login(page, 'creator');
    await expect(page.getByRole('heading', { name: 'Olá, Caio' })).toBeVisible();

    await test.step('as telas de criação abrem; a equipe não existe para ele', async () => {
      for (const path of ['/criar', '/foto', '/midia']) expect((await page.goto(path))?.status(), path).toBe(200);
      expect((await page.goto('/configuracoes/equipe'))?.status()).toBe(404);
      await expect(page.getByText('Página ou pendência não encontrada.')).toBeVisible();
    });

    await test.step('a API deixa criar post e recusa o que é do administrador', async () => {
      const created = await page.request.post('/api/posts', { data: { idea: 'bolo de cenoura da semana' } });
      expect(created.status()).toBe(201);
      for (const { method, path, data } of ADMIN_ONLY) {
        const res = await page.request.fetch(path, { method, data });
        expect(res.status(), `${method} ${path}`).toBe(403);
        expect(await res.json()).toEqual({ error: FORBIDDEN });
      }
    });
  });

  test('leitor só acompanha: sem criar, sem configurar, sem escrever na API', async ({ page }) => {
    await login(page, 'viewer');
    await expect(page.getByRole('heading', { name: 'Olá, Lia' })).toBeVisible();
    await expect(page.getByText('Você acompanha esta conta como leitor.')).toBeVisible();

    await test.step('o menu mostra só o que ele acompanha', async () => {
      if (!(await page.getByRole('button', { name: 'Mais', exact: true }).isVisible())) {
        for (const name of ['Início', 'Aprovar', 'Agenda', 'Publicados', 'Aprendizado']) await expect(navLink(page, name)).toBeVisible();
        for (const name of ['Criar post', 'Banco de imagens', 'Configurações']) await expect(navLink(page, name)).toHaveCount(0);
      }
    });

    await test.step('as telas de criação e configuração não existem para ele; as de leitura abrem', async () => {
      for (const path of ['/criar', '/foto', '/midia', '/configuracoes', '/configuracoes/canais', '/configuracoes/empresa', '/configuracoes/equipe']) {
        expect((await page.goto(path))?.status(), path).toBe(404);
      }
      for (const path of ['/aprovar', '/agenda', '/historico']) expect((await page.goto(path))?.status(), path).toBe(200);
    });

    await test.step('a API recusa toda escrita', async () => {
      const writes = [{ method: 'POST', path: '/api/posts', data: { idea: 'bolo' } }, { method: 'POST', path: '/api/photo-posts', data: {} }, ...ADMIN_ONLY];
      for (const { method, path, data } of writes) {
        const res = await page.request.fetch(path, { method, data });
        expect(res.status(), `${method} ${path}`).toBe(403);
        expect(await res.json()).toEqual({ error: FORBIDDEN });
      }
    });
  });
});
