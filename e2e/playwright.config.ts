import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { BASE_URL, BLOB_DIR, NO_GCLOUD_DIR, DATABASE_URL, EMULATOR_HOST, FAKES_PORT, FAKES_URL, IDENTITY_PROJECT, PORT } from './support/env';

// Roda o app de verdade (Next em modo dev) contra um Postgres com as migrations e o emulador do
// Firebase Auth. Modo dev porque o app só aceita o emulador fora de produção (firebase-config.ts
// e CSP). Tudo o que o servidor chamaria fora (Vertex, Cloud KMS, Meta) vai para um servidor simulado
// (support/fakes.ts) por um preload que reescreve o fetch e bloqueia qualquer outro host externo;
// as imagens ficam numa pasta local (LOCAL_BLOB_DIR). Nenhuma credencial real existe.
//
// Local:  npm run db:prepare && E2E_DATABASE_URL=... npm run emulator:test   (precisa de Java 21)
// CI:     job `e2e` do ci.yml.

const CI = !!process.env.CI;

// Segredos de teste: gerados aqui, uma vez, no processo principal. Os workers releem este arquivo,
// mas herdam o ambiente já preenchido, então todos veem o mesmo valor.
process.env.E2E_CRON_SECRET ??= randomBytes(16).toString('hex');
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString('hex');
process.env.E2E_APP_SECRET ??= randomBytes(16).toString('hex');
process.env.E2E_FAKES_URL = FAKES_URL;
// Nenhuma credencial real do ambiente entra no teste: sem isso o Google Auth usaria o login do gcloud da máquina.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const preload = fileURLToPath(new URL('./support/app-preload.mjs', import.meta.url));

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './support/global-setup.ts',
  // As contas e o banco são um só: os specs compartilham estado, então um worker por vez.
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'on',
    trace: 'retain-on-failure',
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
    cwd: '../platform',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    // O log do Next só entra quando o servidor falha: com 'pipe' cada requisição vira linha no relatório.
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL,
      AUTH_PROVIDER: 'identity',
      AUTH_SECRET: process.env.E2E_AUTH_SECRET,
      CRON_SECRET: process.env.E2E_CRON_SECRET,
      IDENTITY_PROJECT_ID: IDENTITY_PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST: EMULATOR_HOST,
      // Sem app autenticador no teste: o segundo fator tem teste próprio (BEZ-27, no staging).
      MFA_MODE: 'optional',
      APP_BASE_URL: BASE_URL,
      // Serviços externos: tudo vai para o servidor simulado (support/fakes.ts) e o resto é bloqueado.
      NODE_OPTIONS: `--import=${preload}`,
      E2E_FAKES_URL: FAKES_URL,
      CLOUDSDK_CONFIG: NO_GCLOUD_DIR,
      GCE_METADATA_HOST: `127.0.0.1:${FAKES_PORT}`,
      METADATA_SERVER_DETECTION: 'assume-present',
      VERTEX_PROJECT_ID: 'projeto-e2e',
      KMS_KEY_NAME: 'projects/projeto-e2e/locations/global/keyRings/e2e/cryptoKeys/e2e',
      INSTAGRAM_APP_ID: '1234567890',
      INSTAGRAM_APP_SECRET: process.env.E2E_APP_SECRET,
      LOCAL_BLOB_DIR: BLOB_DIR,
      // A URL pública da imagem é absoluta, como na Meta de verdade (que busca a arte por ela).
      MEDIA_BASE_URL: `${BASE_URL}/api/media`,
      // O modo dev recompila cada rota num módulo novo, e cada módulo abre o próprio pool: com o teto
      // padrão (5) o Postgres do teste fica sem conexão ("too many clients").
      DB_POOL_MAX: '2',
    },
  },
});
