import type { Page } from '@playwright/test';
import { test, expect } from '../support/test';
import { fakeCalls, resetFakes } from '../support/fakes';
import { saveMinimalProfile } from '../support/flows';
import { resetAccount } from '../support/seed';
import { login } from '../support/session';

// O Studio de edição do post, as versões e a regra de marca (SPEC 019 e 024). Modelo e Meta são simulados
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

// A nota do editor (aviso do revisor, "mudanças sem confirmar" ou o resultado do Confirmar).
const status = (page: Page) => page.locator('p[aria-live="polite"]');
const confirmButton = (page: Page) => page.getByRole('button', { name: 'Confirmar', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: /Imagem do post/ });

// O Studio abre por "Editar imagem" em Aprovar. No desktop as camadas são uma lista; no celular, chips.
async function openStudio(page: Page, post: Post) {
  await page.goto(post.inbox);
  await page.getByRole('link', { name: 'Editar imagem' }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Propriedades' })).toBeVisible();
}
const pick = (page: Page, name: string) =>
  page
    .getByRole('option')
    .filter({ hasText: name })
    .getByRole('button')
    .first()
    .or(page.getByRole('group', { name: 'Elementos' }).getByRole('button', { name, exact: true }))
    .first()
    .click();

// Outra pessoa salva uma versão do mesmo post (a rota que a tela usa, com a sessão desta página).
async function saveAsOtherEditor(page: Page, briefId: string, change: (design: Record<string, unknown>) => Record<string, unknown>) {
  const state = await page.request.get(`/api/posts/${briefId}/design/revisions`);
  expect(state.ok()).toBe(true);
  const { version, editable } = (await state.json()) as { version: number; editable: Record<string, unknown> };
  const saved = await page.request.post(`/api/posts/${briefId}/design/revisions`, { data: { baseVersion: version, design: change(editable) } });
  expect(saved.status()).toBe(201);
}

// Outra pessoa grava uma cena nova (a rota que o editor usa, com a sessão desta página): esconde a primeira camada de texto.
async function saveSceneAsOtherEditor(page: Page, briefId: string) {
  const res = await page.request.get(`/api/posts/${briefId}/design/scene`);
  expect(res.ok()).toBe(true);
  const { version, scene } = (await res.json()) as { version: number; scene: { layers: Array<Record<string, unknown>> } };
  scene.layers[0] = { ...scene.layers[0], locked: true };
  const saved = await page.request.put(`/api/posts/${briefId}/design/scene`, { data: { baseVersion: version, scene } });
  expect(saved.status()).toBe(201);
}

test.describe.serial('Studio, versões e regra de marca', () => {
  const posts: Post[] = [];

  test.beforeAll(async () => {
    await resetAccount();
    await resetFakes();
  });

  test('Aprovar abre o Studio em camadas e confirmar salva a versão 2 sem chamar o modelo', async ({ page }) => {
    await login(page, 'admin');
    await saveMinimalProfile(page);
    posts.push(await createPost(page, 'dica de bolo pronto'));
    await expect(page.getByRole('link', { name: 'Editar imagem' })).toBeVisible();
    await expect(page.getByText('Ajuste rápido')).toHaveCount(0);

    await openStudio(page, posts[0]);
    await expect(page.getByText('Esta é a versão inicial. Faça um ajuste e confirme para salvar a versão 2.')).toBeVisible();
    await expect(status(page)).toContainText('Nenhuma mudança ainda');
    await expect(confirmButton(page)).toBeDisabled();
    const modelBefore = (await fakeCalls(/aiplatform/)).length;

    await pick(page, 'Selo');
    await page.getByRole('button', { name: 'Travar', exact: true }).click();
    await expect(status(page)).toContainText('Mudanças sem confirmar');
    await confirmButton(page).click();

    await expect(page.getByText(/Salvo como versão 2/)).toBeVisible();
    await expect(page.getByText('Versão 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Versão inicial', { exact: true })).toBeVisible();
    // desenhar as camadas é trabalho do servidor: o modelo não foi chamado nem uma vez
    expect((await fakeCalls(/aiplatform/)).length).toBe(modelBefore);

    await page.getByRole('link', { name: 'Voltar ao post', exact: true }).click();
    await expect(page.getByText(/Versão 2 em uso/)).toBeVisible();
  });

  // O post sem marca nasce escuro (BEZ-368): o texto que perde o contraste é o quase preto, não o branco.
  test('cor com contraste baixo trava o Confirmar e diz o motivo; desfazer volta', async ({ page }) => {
    await login(page, 'admin');
    await openStudio(page, posts[0]);

    await pick(page, 'Título');
    await page.getByRole('group', { name: 'Cor do texto' }).getByRole('button', { name: 'Quase preto' }).click();
    await expect(status(page)).toContainText('Contraste baixo no título');
    await expect(confirmButton(page)).toBeDisabled();

    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect(status(page)).not.toContainText('Contraste baixo');
  });

  test('inserir texto e forma, apagar, e voltar ao layout automático grava uma versão', async ({ page }) => {
    await login(page, 'admin');
    await openStudio(page, posts[0]);

    await page.getByRole('tab', { name: 'Inserir' }).or(page.getByRole('button', { name: '+ Texto' })).first().click();
    if (await page.getByRole('tab', { name: 'Inserir' }).isVisible()) await page.getByRole('button', { name: /Texto$/ }).click();
    await expect(page.getByRole('heading', { name: 'Texto novo' })).toBeVisible();
    await page.getByRole('button', { name: 'Apagar', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Texto novo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect(status(page)).toContainText('Nenhuma mudança ainda');

    // o post já tem camadas (versão 2): voltar ao layout automático é uma versão nova
    await page.getByRole('button', { name: 'Voltar ao layout automático' }).click();
    await expect(page.getByText('Voltou ao layout automático.')).toBeVisible();
    await expect(page.getByText('Versão 3', { exact: true })).toBeVisible();
  });

  test('baixar o PNG e o SVG da versão em uso', async ({ page }) => {
    await login(page, 'admin');
    await openStudio(page, posts[0]);
    const png = await page.request.get(`/api/posts/${posts[0].briefId}/design/export?format=png`);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toBe('image/png');
    expect(png.headers()['content-disposition']).toContain('post-imagem.png');
    const svg = await page.request.get(`/api/posts/${posts[0].briefId}/design/export?format=svg`);
    expect(svg.status()).toBe(200);
    expect(await svg.text()).toMatch(/<text /);
    expect((await page.request.get(`/api/posts/${posts[0].briefId}/design/export?format=pdf`)).status()).toBe(400);
  });

  test('um segundo editor salvou antes: a tela mostra o conflito e não perde o ajuste', async ({ page }) => {
    await login(page, 'admin');
    posts.push(await createPost(page, 'dica de recheio'));
    await openStudio(page, posts[1]);

    await saveSceneAsOtherEditor(page, posts[1].briefId);
    await pick(page, 'Título');
    await page.getByRole('button', { name: 'Travar', exact: true }).click();
    await confirmButton(page).click();

    // a faixa de publicação pausada também é um alerta: o conflito se acha pelo texto
    const conflict = page.getByRole('alert').filter({ hasText: 'Nada seu foi apagado' });
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Abrir a versão nova' }).click();
    await expect(status(page)).toContainText('Nenhuma mudança ainda');
    await pick(page, 'Título');
    await page.getByRole('button', { name: 'Travar', exact: true }).click();
    await confirmButton(page).click();
    await expect(page.getByText(/Salvo como versão 3/)).toBeVisible();
  });

  test('a mesma mudança em 3 posts vira regra proposta; aceitar, desligar e ligar de novo em Aprendizado', async ({ page }) => {
    await login(page, 'admin');
    // ajustes pelos campos (o ajuste do logo) continuam alimentando o aprendizado: três posts, a mesma mudança, pela API
    posts.push(await createPost(page, 'dica de cobertura'));
    for (const post of posts) await saveAsOtherEditor(page, post.briefId, (d) => ({ ...d, logoCorner: 'br' }));

    await page.goto('/aprendizado?tab=design');
    await expect(page.getByText(/Você moveu o logo para o canto inferior direito em 3 posts/)).toBeVisible();
    await page.getByRole('button', { name: 'Aceitar regra' }).click();
    await expect(page.getByRole('link', { name: 'Design do post' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Logo no canto inferior direito', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Desligar a regra: Logo no canto inferior direito/ }).click();
    await expect(page.getByRole('button', { name: /Ligar de novo a regra: Logo no canto inferior direito/ })).toBeVisible();
    await page.getByRole('button', { name: /Ligar de novo a regra/ }).click();
    await expect(page.getByRole('button', { name: /Desligar a regra: Logo no canto inferior direito/ })).toBeVisible();
  });

  test('o leitor vê as versões no Studio, sem editar, e a API recusa a edição', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto(posts[0].inbox);
    await page.getByRole('link', { name: 'Ver versões' }).click();
    await expect(page).toHaveURL(/\/studio$/);
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
