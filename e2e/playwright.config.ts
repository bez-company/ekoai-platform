import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, DATABASE_URL, EMULATOR_HOST, IDENTITY_PROJECT, PORT } from './support/env';

// Roda o app de verdade (Next em modo dev) contra um Postgres com as migrations e o emulador do
// Firebase Auth. Modo dev porque o app só aceita o emulador fora de produção (firebase-config.ts
// e CSP). Tudo o que sai para fora (IA, Meta) fica simulado nas frentes seguintes: aqui nenhuma
// credencial real existe.
//
// Local:  npm run db:prepare && E2E_DATABASE_URL=... npm run emulator:test   (precisa de Java 21)
// CI:     job `e2e` do ci.yml.

const CI = !!process.env.CI;

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
      AUTH_SECRET: randomBytes(32).toString('hex'),
      CRON_SECRET: randomBytes(16).toString('hex'),
      IDENTITY_PROJECT_ID: IDENTITY_PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST: EMULATOR_HOST,
      // Sem app autenticador no teste: o segundo fator tem teste próprio (BEZ-27, no staging).
      MFA_MODE: 'optional',
      APP_BASE_URL: BASE_URL,
    },
  },
});
