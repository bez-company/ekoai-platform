import { expect, type Page } from '@playwright/test';
import { fakeCalls } from './fakes';

// Passos que mais de um spec repete. Cada um passa pela tela, como a pessoa faria.

// Perfil mínimo: o resto da empresa se completa depois. É o único atalho por API (a tela do perfil
// tem o próprio spec, o de onboarding).
export async function saveMinimalProfile(page: Page) {
  const res = await page.request.put('/api/profile', {
    data: { section: 'about', niche: 'Alimentação', offering: 'Bolos sob encomenda para festas', audience: 'Famílias da região' },
  });
  expect(res.ok()).toBe(true);
}

export async function connectInstagram(page: Page) {
  await page.goto('/configuracoes/canais');
  await expect(page.getByText('Nenhum Instagram conectado')).toBeVisible();
  await page.getByRole('link', { name: 'Conectar Instagram' }).click();
  await expect(page).toHaveURL(/\/configuracoes\/canais\?ig=connected/);
  await expect(page.getByText('Instagram conectado. Os posts aprovados já podem ir para ele.')).toBeVisible();
  await expect(page.getByText('@doceponto.teste')).toBeVisible();
  // o token só sai do app cifrado: o KMS simulado recebeu a cifra
  expect((await fakeCalls(/cloudkms/)).some((c) => c.path.endsWith(':encrypt'))).toBe(true);
}

// A conta criada pelo cadastro nasce com a publicação ligada (BEZ-361); a criada direto no banco nasce pausada
// pelo gatilho da 0013. Retoma só quando estiver pausada.
export async function resumePublishing(page: Page) {
  await page.goto('/configuracoes');
  if (await page.getByText(/Pausada desde/).isVisible()) await page.getByRole('button', { name: 'Retomar publicação' }).click();
  await expect(page.getByText(/Publicando normalmente/)).toBeVisible();
}

// Sem horários na Agenda, grava cinco (segunda a sexta, 18h) pela mesma rota que o diálogo Horários usa; cada horário é um
// post por semana. O diálogo em si tem o teste da tela vazia; aqui o que importa é a conta ter ritmo para publicar.
export async function pickRhythm(page: Page) {
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Escolha quando publicar' })).toBeVisible();
  const slots = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, hour: 18, minute: 0 }));
  const res = await page.request.put('/api/slots', { data: { channel: 'instagram', slots } });
  expect(res.ok()).toBe(true);
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Escolha quando publicar' })).toBeHidden();
  await expect(page.getByText('5 horários na semana')).toBeVisible();
}

// Conta pronta para publicar: perfil, Instagram, publicação retomada e horários.
export async function readyToPublish(page: Page) {
  await saveMinimalProfile(page);
  await connectInstagram(page);
  await resumePublishing(page);
  await pickRhythm(page);
}

// Lê a largura e a altura de um PNG (cabeçalho IHDR).
export function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// O post agendado aparece na Agenda. Depois da última faixa da semana (sexta à noite, fim de semana) o
// próximo horário livre cai na semana seguinte, então o passo avança de semana se precisar.
export async function expectInCalendar(page: Page, name: RegExp) {
  await page.goto('/agenda');
  const entry = page.getByRole('button', { name });
  await expect(async () => {
    if (!(await entry.isVisible())) await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(entry).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}
