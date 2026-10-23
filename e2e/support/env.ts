// env.ts: valores compartilhados entre a config, o seed e os specs. Nada de segredo aqui: a senha
// das contas de teste é gerada a cada rodada (global-setup) e só vale no emulador de login.

export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
export const IDENTITY_PROJECT = 'demo-post-automation';

export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:ci@localhost:5432/ekoai_e2e';

export const TENANT_ID = 'e2e-acme';
export const TENANT_NAME = 'Doce Ponto Confeitaria';

// Domínio reservado (.test): o repositório é público e nenhum e-mail real entra aqui.
export const ACCOUNTS = {
  admin: { email: 'admin@e2e.example.test', name: 'Ana Admin', role: 'admin' },
  creator: { email: 'criador@e2e.example.test', name: 'Caio Criador', role: 'creator' },
  viewer: { email: 'leitor@e2e.example.test', name: 'Lia Leitora', role: 'viewer' },
} as const;

export type Persona = keyof typeof ACCOUNTS;

export function password(): string {
  const value = process.env.E2E_PASSWORD;
  if (!value) throw new Error('E2E_PASSWORD ausente: o global-setup não rodou');
  return value;
}

// Serviços externos simulados (support/fakes.ts). O app os alcança por um preload que reescreve o
// fetch (support/app-preload.mjs); qualquer outro host externo é bloqueado.
export const FAKES_PORT = Number(process.env.E2E_FAKES_PORT ?? 4010);
export const FAKES_URL = `http://127.0.0.1:${FAKES_PORT}`;

// Armazenamento de imagens do app sem Cloud Storage (LOCAL_BLOB_DIR, só fora de produção).
export const BLOB_DIR = new URL('../.tmp/blobs', import.meta.url).pathname;

// Pasta vazia no lugar da configuração do gcloud: o app não acha credencial da máquina e usa o servidor de metadados simulado.
export const NO_GCLOUD_DIR = new URL('../.tmp/no-gcloud', import.meta.url).pathname;

// Segredo do cron do app sob teste (gerado pela config; os specs chamam /api/cron/* com ele).
export function cronSecret(): string {
  const value = process.env.E2E_CRON_SECRET;
  if (!value) throw new Error('E2E_CRON_SECRET ausente: a config do Playwright não rodou');
  return value;
}
