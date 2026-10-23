import type { Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { fakeCalls, programAsk, resetFakes } from '../support/fakes';
import { saveMinimalProfile } from '../support/flows';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// "Pedir ajuste" em texto livre (SPEC 024, BEZ-193). O modelo é simulado (support/fakes.ts): o teste programa o
// patch que ele devolve. O resto é o app de verdade: o navegador, a rota, o banco, o desenho no servidor e o
// revisor por regra. Prova que o ajuste de texto não chama o modelo de imagem, grava a versão 2, mostra antes e
// depois, desfaz por versão nova e que "Visual" avisa do limite sem chamar modelo nenhum.
type Post = { briefId: string; inbox: string };

async function createPost(page: Page, idea: string): Promise<Post> {
  await page.goto('/criar');
  await page.getByRole('textbox', { name: 'Descreva o que você quer no post' }).fill(idea);
  await page.getByRole('button', { name: 'Criar post', exact: true }).click();
  await expect(page).toHaveURL(/\/criar\/[0-9a-f-]{36}$/);
  const briefId = page.url().split('/').pop()!;
  await expect(page.getByText('O post está pronto.')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('link', { name: 'Revisar o post' }).click();
  await expect(page).toHaveURL(/\/aprovar\/plat-/);
  return { briefId, inbox: new URL(page.url()).pathname };
}

const box = (page: Page) => page.getByRole('textbox', { name: 'O que você quer mudar?' });
const imageCalls = async () => (await fakeCalls(/aiplatform/)).filter((c) => Array.isArray((c.body as { generationConfig?: { responseModalities?: unknown } })?.generationConfig?.responseModalities));

test.describe.serial('pedir ajuste em texto livre', () => {
  let post: Post;

  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('tirar o subtítulo aplica, mostra o antes e depois, grava a versão 2 e não chama o modelo de imagem', async ({ page }) => {
    await login(page, 'admin');
    await saveMinimalProfile(page);
    post = await createPost(page, 'dica de bolo pronto');

    const imagesBefore = (await imageCalls()).length;
    const textBefore = (await fakeCalls(/aiplatform/)).length - imagesBefore;
    await box(page).fill('Tira o subtítulo e deixa só os 3 itens.');
    await page.getByRole('button', { name: 'Aplicar ajuste' }).click();

    await expect(page.getByText('Ajuste aplicado.')).toBeVisible();
    const changes = page.getByRole('list', { name: 'O que mudou' });
    await expect(changes).toContainText('Subtítulo');
    await expect(changes).toContainText('removido');
    await expect(changes).toContainText('Todo o resto');
    await expect(page.getByText('Versão 2', { exact: true })).toBeVisible();

    // uma chamada de texto para ler o pedido, nenhuma de imagem
    const all = await fakeCalls(/aiplatform/);
    expect(all.length - (await imageCalls()).length).toBe(textBefore + 1);
    expect((await imageCalls()).length).toBe(imagesBefore);
  });

  test('desfazer o ajuste volta ao design anterior como versão nova, e a lista guarda as três', async ({ page }) => {
    await login(page, 'admin');
    await page.goto(post.inbox);
    await box(page).fill('Tira o subtítulo.');
    // o design em uso já não tem subtítulo: o patch não muda nada e a tela explica, sem gravar versão
    await page.getByRole('button', { name: 'Aplicar ajuste' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'A Ekoai não achou o que mudar nesse pedido' })).toBeVisible();

    await programAsk({ image: { texts: { sub: 'Confira sem abrir o forno' } } });
    await box(page).fill('Põe o subtítulo de volta: Confira sem abrir o forno.');
    await page.getByRole('button', { name: 'Aplicar ajuste' }).click();
    await expect(page.getByText('Ajuste aplicado.')).toBeVisible();
    await expect(page.getByText('Versão 3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Desfazer ajuste' }).click();
    await expect(page.getByText('Ajuste desfeito.')).toBeVisible();
    await expect(page.getByText('Versão 4', { exact: true })).toBeVisible();
    const state = await page.request.get(`/api/posts/${post.briefId}/design/revisions`);
    const { version, revisions, editable } = (await state.json()) as { version: number; revisions: unknown[]; editable: { texts: { sub?: string } } };
    expect(version).toBe(4);
    expect(revisions).toHaveLength(4);
    expect(editable.texts.sub).toBeUndefined();
  });

  test('"Visual" avisa que conta no limite e leva a Outra direção, sem chamar modelo', async ({ page }) => {
    await login(page, 'admin');
    await page.goto(post.inbox);
    const before = (await fakeCalls(/aiplatform/)).length;
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await box(page).fill('Troca o fundo por uma foto de bolo cortado.');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Visual novo gera o post de novo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar outra direção' }).first()).toBeVisible();
    expect((await fakeCalls(/aiplatform/)).length).toBe(before);
  });

  test('pedido que não dá para cumprir mostra o motivo e não grava versão', async ({ page }) => {
    await login(page, 'admin');
    await page.goto(post.inbox);
    await programAsk({ notApplied: [{ what: 'Fonte', why: 'A fonte vem da marca da empresa. Mude em Configurações › Empresa.' }] });
    await box(page).fill('Troca a fonte para Comic Sans.');
    await page.getByRole('button', { name: 'Aplicar ajuste' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'A fonte vem da marca da empresa' })).toBeVisible();
    const state = await page.request.get(`/api/posts/${post.briefId}/design/revisions`);
    expect(((await state.json()) as { version: number }).version).toBe(4);
  });

  test('o leitor não vê o campo e a API recusa o pedido', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto(post.inbox);
    await expect(page.getByRole('region', { name: 'Versões' })).toBeVisible();
    await expect(box(page)).toHaveCount(0);
    const ask = await page.request.post(`/api/posts/${post.briefId}/design/ask`, { data: { baseVersion: 4, instruction: 'Tira o subtítulo' } });
    expect(ask.status()).toBe(403);
  });
});
