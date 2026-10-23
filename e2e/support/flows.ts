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
  await page.goto('/settings/channels');
  await expect(page.getByText('Nenhum Instagram conectado')).toBeVisible();
  await page.getByRole('link', { name: 'Conectar Instagram' }).click();
  await expect(page).toHaveURL(/\/settings\/channels\?ig=connected/);
  await expect(page.getByText('Instagram conectado. Os posts aprovados já podem ir para ele.')).toBeVisible();
  await expect(page.getByText('@doceponto.teste')).toBeVisible();
  // o token só sai do app cifrado: o KMS simulado recebeu a cifra
  expect((await fakeCalls(/cloudkms/)).some((c) => c.path.endsWith(':encrypt'))).toBe(true);
}

// A conta nova nasce com a publicação pausada.
export async function resumePublishing(page: Page) {
  await page.goto('/settings');
  await expect(page.getByText(/Pausada desde/)).toBeVisible();
  await page.getByRole('button', { name: 'Retomar publicação' }).click();
  await expect(page.getByText(/Publicando normalmente/)).toBeVisible();
}

export async function pickRhythm(page: Page) {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Escolha quando publicar' })).toBeVisible();
  await page.getByRole('button', { name: '5 por semana' }).click();
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
  await page.goto('/calendar');
  const entry = page.getByRole('button', { name });
  await expect(async () => {
    if (!(await entry.isVisible())) await page.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(entry).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}
