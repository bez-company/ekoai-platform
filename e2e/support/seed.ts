// seed.ts: deixa banco e emulador de login no estado de uma conta nova, sem perfil: um tenant com
// um administrador, um criador e um leitor. Usa os mesmos scripts de operação do repositório
// (tenant:create e access:grant), então o seed prova que eles continuam funcionando.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ACCOUNTS, DATABASE_URL, EMULATOR_HOST, IDENTITY_PROJECT, TENANT_ID, TENANT_NAME } from './env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// O seed apaga tabelas inteiras: só roda num banco que diz no nome que é de E2E.
async function resetDatabase() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows: [{ name }] } = await client.query<{ name: string }>('select current_database() as name');
    if (!name.includes('e2e')) throw new Error(`recuso limpar o banco "${name}": o nome precisa conter "e2e"`);
    const { rows } = await client.query<{ table_name: string }>(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'`);
    if (rows.length) await client.query(`truncate ${rows.map((r) => `public."${r.table_name}"`).join(', ')} restart identity cascade`);
    await client.query("delete from users where email like '%@e2e.example.test'");
    await client.query('delete from tenants where id = $1', [TENANT_ID]);
  } finally {
    await client.end();
  }
}

function script(name: string, args: string[]) {
  execFileSync('node', [path.join('scripts', name), ...args], { cwd: root, env: { ...process.env, DATABASE_URL }, stdio: 'pipe' });
}

async function emulator(pathname: string, init: RequestInit & { admin?: boolean } = {}) {
  const { admin, ...rest } = init;
  const res = await fetch(`http://${EMULATOR_HOST}${pathname}`, {
    ...rest,
    headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer owner' } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`emulador ${pathname}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// E-mail verificado e senha conhecida: é o estado de quem já confirmou o link. O primeiro login
// liga a pessoa do banco (criada pelo access:grant só com o e-mail) a esta identidade.
async function seedIdentities(password: string) {
  await emulator(`/emulator/v1/projects/${IDENTITY_PROJECT}/accounts`, { method: 'DELETE' });
  for (const account of Object.values(ACCOUNTS)) {
    const { localId } = (await emulator('/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-do-emulador', {
      method: 'POST',
      body: JSON.stringify({ email: account.email, password, displayName: account.name, returnSecureToken: true }),
    })) as { localId: string };
    await emulator(`/identitytoolkit.googleapis.com/v1/projects/${IDENTITY_PROJECT}/accounts:update`, {
      method: 'POST',
      admin: true,
      body: JSON.stringify({ localId, emailVerified: true }),
    });
  }
}

// Conta nova de novo, sem perfil nem post: os specs que mudam o estado da conta chamam isto antes.
// Não mexe no emulador: o primeiro login religa a pessoa do banco à identidade pelo e-mail.
export async function resetAccount() {
  await resetDatabase();
  script('create-tenant.js', ['--id', TENANT_ID, '--name', TENANT_NAME]);
  for (const account of Object.values(ACCOUNTS)) {
    script('grant-access.js', ['--email', account.email, '--tenant', TENANT_ID, '--role', account.role]);
  }
}

export async function seed(password: string) {
  await resetAccount();
  await seedIdentities(password);
}
