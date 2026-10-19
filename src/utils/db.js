// db.js — cliente Postgres (@ekoai/db sobre `pg`). Lazy: só conecta quando usado. O usuário do
// banco é o da aplicação (no Cloud SQL, a service account de cada job); o escopo por tenant é
// feito pelas queries, como era com a service role (SPEC 010).
//
// O pipeline só usa o banco quando STATE_BACKEND=postgres. Sem a flag, tudo continua em YAML
// (legado, sai na fase 1 da SPEC 010 junto com os commits de content/ nos workflows).

import pg from 'pg';
import { createPgDb, pgTypes } from '@ekoai/db';

let pool = null;
let client = null;

export function getDb() {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL é obrigatória para STATE_BACKEND=postgres. Veja .env.example.');
  }
  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX) || 5,
    // O job termina quando acaba o trabalho, sem esperar o pool fechar.
    allowExitOnIdle: true,
    types: pgTypes(pg.types),
  });
  client = createPgDb(pool);
  return client;
}

export async function closeDb() {
  const current = pool;
  pool = null;
  client = null;
  if (current) await current.end();
}

export function usingDb() {
  return process.env.STATE_BACKEND === 'postgres';
}

// Em container o disco some no fim do job: estado em YAML se perderia sem avisar. No Cloud Run
// (que define K_SERVICE ou CLOUD_RUN_JOB) o job recusa subir sem o banco.
export function assertStateBackend(env = process.env) {
  const inCloudRun = Boolean(env.K_SERVICE || env.CLOUD_RUN_JOB);
  if (inCloudRun && env.STATE_BACKEND !== 'postgres') {
    throw new Error('STATE_BACKEND=postgres é obrigatório no Cloud Run: o estado em YAML se perderia no fim do job.');
  }
}
