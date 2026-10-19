// check-db.mjs — valida a conexão com o Postgres e a presença das tabelas que a plataforma usa.
// Lê DATABASE_URL de process.env; se faltar, tenta o .env.local ou o ../.env do backend.
// Uso: node scripts/check-db.mjs
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

function loadEnvFallback() {
  if (process.env.DATABASE_URL) return;
  for (const f of ['.env.local', '../.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnvFallback();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const tables = ['pending_approvals', 'scheduled_posts', 'publish_slots', 'posts'];

const { host, port, pathname } = new URL(process.env.DATABASE_URL);
console.log(`Banco: ${host || 'socket'}${port ? `:${port}` : ''}${pathname}`);
let allOk = true;
for (const t of tables) {
  try {
    const { rows } = await pool.query(`select count(*)::int as n from public."${t}"`);
    console.log(`  ok   ${t.padEnd(20)} ${rows[0].n} linha(s)`);
  } catch (err) {
    allOk = false;
    console.log(`  erro ${t.padEnd(20)} ${err.message}`);
  }
}
await pool.end();

if (!allOk) {
  console.log('\nTabela faltando? Aplique as migrations de supabase/migrations em ordem (o CI faz isso).');
  process.exit(2);
}
console.log('\nBanco acessível e schema pronto.');
