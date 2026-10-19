// migrate.js: aplica as migrations de supabase/migrations em ordem, uma transação por arquivo, e
// guarda o que já rodou em `public.schema_migrations` (versão e checksum). Substitui o
// `supabase db push` no Cloud SQL (ADR 0003, SPEC 010). Roda como o job `migrate` do Cloud Run,
// antes de cada deploy, e localmente com `npm run migrate`.
//
//   DATABASE_URL=postgres://... npm run migrate            # aplica o que falta
//   DATABASE_URL=postgres://... npm run migrate -- --dry-run   # só lista
//
// Banco vazio: roda antes `supabase/ci/bootstrap.sql` (papéis e schema `auth` que as migrations
// antigas citam). Migration já aplicada que mudou de conteúdo é erro: corrija com uma migration
// nova. Duas execuções ao mesmo tempo esperam uma pela outra (advisory lock).

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const LOCK_KEY = 7_294_015; // qualquer inteiro fixo: só precisa ser o mesmo em todas as execuções

export const checksum = sql => createHash('sha256').update(sql).digest('hex');

export async function listMigrations(dir) {
  const names = (await readdir(dir)).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort();
  return Promise.all(names.map(async name => {
    const sql = await readFile(path.join(dir, name), 'utf8');
    return { version: name.replace(/\.sql$/, ''), sql, checksum: checksum(sql) };
  }));
}

// { pending, drifted }: o que falta aplicar e o que já foi aplicado com outro conteúdo.
export function plan(files, applied) {
  const known = new Map(applied.map(r => [r.version, r.checksum]));
  return {
    pending: files.filter(f => !known.has(f.version)),
    drifted: files.filter(f => known.has(f.version) && known.get(f.version) !== f.checksum),
  };
}

export async function migrate({
  url,
  dir = 'supabase/migrations',
  bootstrap = 'supabase/ci/bootstrap.sql',
  dryRun = false,
  log = console.log,
}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      create table if not exists public.schema_migrations (
        version    text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )`);
    const { rows: applied } = await client.query('select version, checksum from public.schema_migrations');
    const files = await listMigrations(dir);
    const { pending, drifted } = plan(files, applied);

    if (drifted.length) {
      throw new Error(`Migration já aplicada foi alterada: ${drifted.map(f => f.version).join(', ')}. Reverta o arquivo e crie uma migration nova.`);
    }
    if (!pending.length) {
      log('Banco em dia, nenhuma migration pendente.');
      return { applied: [], pending: [] };
    }
    log(`Pendentes (${pending.length}): ${pending.map(f => f.version).join(', ')}`);
    if (dryRun) return { applied: [], pending: pending.map(f => f.version) };

    if (applied.length === 0) {
      log('Banco vazio: aplicando o bootstrap (papéis e schema auth).');
      await client.query(await readFile(bootstrap, 'utf8'));
    }
    const done = [];
    for (const file of pending) {
      try {
        await client.query('begin');
        await client.query(file.sql);
        await client.query('insert into public.schema_migrations (version, checksum) values ($1, $2)', [file.version, file.checksum]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw new Error(`Falha em ${file.version}: ${err.message}`);
      }
      log(`aplicada ${file.version}`);
      done.push(file.version);
    }
    return { applied: done, pending: [] };
  } finally {
    await client.end();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL.');
    process.exit(1);
  }
  try {
    await migrate({ url, dryRun: process.argv.includes('--dry-run') });
  } catch (err) {
    console.error(`[migrate] ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
