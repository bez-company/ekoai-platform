import type { Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { fakeCalls, resetFakes } from '../support/fakes';
import { saveMinimalProfile } from '../support/flows';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// O Estúdio de edição do post, as versões e a regra de marca (SPEC 019 e 024). Modelo e Meta são simulados
// (support/fakes.ts); o resto é o app de verdade: o navegador, o servidor que desenha a prévia, o banco e
// o revisor por regra. Três posts nascem pela interface, e os passos que dependem de um segundo editor
// usam a API com a sessão da mesma pessoa (o 409 não depende de quem é o outro editor).
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

const status = (page: Page) => page.locator('#design-status');
const confirmButton = (page: Page) => page.getByRole('button', { name: 'Confirmar', exact: true });
const corner = (page: Page) => page.getByRole('button', { name: 'Logo no canto inferior direito' });

// O Estúdio abre por "Editar imagem" em Aprovar. No desktop os elementos são uma lista; no celular, chips.
async function openStudio(page: Page, post: Post) {
  await page.goto(post.inbox);
  await page.getByRole('link', { name: 'Editar imagem' }).click();
  await expect(page).toHaveURL(/\/estudio$/);
  await expect(page.getByRole('complementary', { name: 'Propriedades' })).toBeVisible();
}
// O elemento sem conteúdo (selo ou subtítulo removido) leva "sem" no nome acessível: o nome casa pelo começo.
const pick = (page: Page, name: string) => {
  const label = new RegExp(`^${name}( sem)?$`);
  return page.getByRole('option', { name: label }).or(page.getByRole('group', { name: 'Elementos do post' }).getByRole('button', { name: label })).click();
};

// Outra pessoa salva uma versão do mesmo post (a rota que a tela usa, com a sessão desta página).
async function saveAsOtherEditor(page: Page, briefId: string, change: (design: Record<string, unknown>) => Record<string, unknown>) {
  const state = await page.request.get(`/api/posts/${briefId}/design/revisions`);
  expect(state.ok()).toBe(true);
  const { version, editable } = (await state.json()) as { version: number; editable: Record<string, unknown> };
  const saved = await page.request.post(`/api/posts/${briefId}/design/revisions`, { data: { baseVersion: version, design: change(editable) } });
  expect(saved.status()).toBe(201);
}

test.describe.serial('Estúdio, versões e regra de marca', () => {
  const posts: Post[] = [];

  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('Aprovar abre o Estúdio, a prévia vem do servidor e confirmar salva a versão 2 sem chamar o modelo', async ({ page }) => {
    await login(page, 'admin');
    await saveMinimalProfile(page);
    posts.push(await createPost(page, 'dica de bolo pronto'));
    await expect(page.getByRole('link', { name: 'Editar imagem' })).toBeVisible();
    await expect(page.getByText('Ajuste rápido')).toHaveCount(0);

    await openStudio(page, posts[0]);
    await expect(page.getByText('Esta é a versão inicial. Faça um ajuste e confirme para salvar a versão 2.')).toBeVisible();
    await expect(confirmButton(page)).toBeDisabled();
    const modelBefore = (await fakeCalls(/aiplatform/)).length;

    await pick(page, 'Logo');
    await corner(page).click();
    await pick(page, 'Subtítulo');
    await page.getByRole('button', { name: 'Remover subtítulo' }).click();
    await expect(status(page)).toContainText('2 mudanças sem confirmar: subtítulo removido, logo movido para o canto inferior direito');
    await confirmButton(page).click();

    await expect(page.getByText('Versão 2 salva e em uso.')).toBeVisible();
    await expect(page.getByText('Versão 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Versão inicial', { exact: true })).toBeVisible();
    // ajustar texto, cor e logo é desenho no servidor: o modelo não foi chamado nem uma vez
    expect((await fakeCalls(/aiplatform/)).length).toBe(modelBefore);

    await page.getByRole('link', { name: 'Voltar ao post', exact: true }).click();
    await expect(page.getByText(/Versão 2 em uso/)).toBeVisible();
  });

  // O post sem marca nasce escuro (BEZ-368): o texto que perde o contraste é o quase preto, não o branco.
  test('cor com contraste baixo trava o Confirmar e diz o motivo; desfazer e Padrão voltam', async ({ page }) => {
    await login(page, 'admin');
    await openStudio(page, posts[0]);

    await pick(page, 'Título');
    await page.getByRole('button', { name: 'Cor do título: Quase preto' }).click();
    await expect(status(page)).toContainText('Contraste baixo no título');
    await expect(confirmButton(page)).toBeDisabled();

    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect(status(page)).toContainText('Nenhuma mudança ainda');

    await pick(page, 'Logo');
    await page.getByLabel('Esconder o logo neste post').check();
    await expect(status(page)).toContainText('logo escondido');
    await page.getByRole('button', { name: 'Padrão', exact: true }).click();
    await expect(status(page)).toContainText('Nenhuma mudança ainda');
  });

  test('cor do subtítulo e dos itens, selo, itens e layout entram como mudança e mostram o contraste', async ({ page }) => {
    await login(page, 'admin');
    await openStudio(page, posts[0]);

    await pick(page, 'Subtítulo');
    await page.getByRole('textbox', { name: 'Texto do subtítulo' }).fill('Confira antes de desenformar'); // o subtítulo foi removido na versão 2: escrever de novo o adiciona
    await expect(status(page)).toContainText('subtítulo adicionado');
    await pick(page, 'Selo');
    await page.getByRole('button', { name: 'Remover selo' }).click();
    await expect(status(page)).toContainText('selo removido');
    await pick(page, 'Itens');
    await page.getByRole('textbox', { name: 'Item 1' }).fill('A massa solta da borda');
    await expect(status(page)).toContainText('item 1 alterado');
    await page.getByRole('button', { name: 'Cor dos itens: Cor de destaque da marca' }).click();
    await expect(page.getByText(/Contraste \d+,\d:1 sobre o fundo/)).toBeVisible();

    await pick(page, 'Layout');
    const group = page.getByRole('group', { name: 'Layouts compatíveis' });
    await expect(group.getByText('Lista numerada')).toBeVisible();
    await expect(group.getByText('Título em destaque')).toBeVisible();
    await group.getByRole('button', { name: /Título em destaque/ }).click();
    await expect(status(page)).toContainText('layout trocado para título em destaque');
    await page.getByRole('button', { name: 'Padrão', exact: true }).click();
  });

  test('um segundo editor salvou antes: a tela mostra o conflito e não perde o ajuste', async ({ page }) => {
    await login(page, 'admin');
    posts.push(await createPost(page, 'dica de recheio'));
    await openStudio(page, posts[1]);

    await saveAsOtherEditor(page, posts[1].briefId, (d) => ({ ...d, logoCorner: 'tl' }));
    await pick(page, 'Logo');
    await page.getByLabel('Esconder o logo neste post').check();

    // a faixa de publicação pausada também é um alerta: o conflito se acha pelo texto
    const conflict = page.getByRole('alert').filter({ hasText: 'salvou a versão 2 enquanto você editava' });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('Suas mudanças continuam na tela.');
    await expect(confirmButton(page)).toBeDisabled();
    await page.getByRole('button', { name: /Refazer sobre a versão 2/ }).click();
    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();
    await expect(page.getByText('Versão 3 salva e em uso.')).toBeVisible();
  });

  test('a mesma mudança em 3 posts vira regra proposta; aceitar, desligar e ligar de novo em Aprendizado', async ({ page }) => {
    await login(page, 'admin');
    // o terceiro post: o primeiro já tem o logo no canto inferior direito, o segundo vai agora pela API
    await saveAsOtherEditor(page, posts[1].briefId, (d) => ({ ...d, logoCorner: 'br', logoHidden: undefined }));
    posts.push(await createPost(page, 'dica de cobertura'));
    await openStudio(page, posts[2]);
    await pick(page, 'Logo');
    await corner(page).click();
    await confirmButton(page).click();

    await expect(page.getByText('A Ekoai notou um padrão.')).toBeVisible();
    await expect(page.getByText(/Você moveu o logo para o canto inferior direito em 3 posts/)).toBeVisible();
    await page.getByRole('button', { name: 'Aceitar regra' }).click();
    await expect(page.getByText('Regra ativa: Logo no canto inferior direito.')).toBeVisible();

    await page.goto('/aprendizado?tab=design');
    await expect(page.getByRole('link', { name: 'Design do post' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Logo no canto inferior direito', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Desligar a regra: Logo no canto inferior direito/ }).click();
    await expect(page.getByRole('button', { name: /Ligar de novo a regra: Logo no canto inferior direito/ })).toBeVisible();
    await page.getByRole('button', { name: /Ligar de novo a regra/ }).click();
    await expect(page.getByRole('button', { name: /Desligar a regra: Logo no canto inferior direito/ })).toBeVisible();
  });

  test('o leitor vê as versões no Estúdio, sem editar, e a API recusa a edição', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto(posts[0].inbox);
    await page.getByRole('link', { name: 'Ver versões' }).click();
    await expect(page).toHaveURL(/\/estudio$/);
    await expect(page.getByRole('region', { name: 'Versões' })).toBeVisible();
    await expect(page.getByText('Você acompanha esta conta como leitor.')).toBeVisible();
    await expect(confirmButton(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Pedir à Ekoai' })).toHaveCount(0);
    // a API recusa mesmo chamada direto
    const edit = await page.request.post(`/api/posts/${posts[0].briefId}/design/preview`, { data: { baseVersion: 2, design: { layout: 'lista-numerada', texts: { title: 'x' } } } });
    expect(edit.status()).toBe(403);
  });

  test('o criador lê as regras do design, mas não decide', async ({ page }) => {
    await login(page, 'creator');
    await page.goto('/aprendizado?tab=design');
    await expect(page.getByText('Só administradores aceitam, desligam e desfazem regras do design.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Desligar a regra/ })).toHaveCount(0);
    const accept = await page.request.post('/api/design-rules/00000000-0000-4000-8000-000000000000/accept');
    expect(accept.status()).toBe(403);
  });
});
