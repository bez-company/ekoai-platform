// prepare-db.mjs: cria o banco de E2E e aplica o bootstrap e as migrations, para rodar local.
// No CI o workflow faz o mesmo com `psql`. Recusa banco cujo nome não contém "e2e": o seed
// apaga tabelas inteiras.
//
//   E2E_ADMIN_DATABASE_URL=postgresql://localhost:5432/postgres npm run db:prepare
//
// Aponta para o banco de manutenção do seu Postgres local; o banco `ekoai_e2e` é criado ao lado.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgresql://localhost:5432/postgres';
const dbName = 'ekoai_e2e';

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
if (!rowCount) await admin.query(`create database ${dbName}`);
await admin.end();

const url = new URL(adminUrl);
url.pathname = `/${dbName}`;
const psql = (...args) => execFileSync('psql', [url.toString(), '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: 'inherit', cwd: root });

psql('-f', 'supabase/ci/bootstrap.sql');
execFileSync('node', ['scripts/migrate.js'], { stdio: 'inherit', cwd: root, env: { ...process.env, DATABASE_URL: url.toString() } });
console.info(`Banco pronto: ${url.toString()}`);
console.info(`Use E2E_DATABASE_URL=${url.toString()} para rodar os testes.`);
