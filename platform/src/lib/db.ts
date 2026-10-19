// Cliente Postgres server-side (@ekoai/db sobre `pg`). O usuário do banco é o da aplicação, sem
// acesso ao navegador: todo acesso passa por Server Components, Route Handlers e o cron. O
// isolamento entre contas vem do tenantDb (tenant-db.ts) e do RLS.

import pg from 'pg';
import { createPgDb, pgTypes, type DbClient } from '@ekoai/db';

let client: DbClient | null = null;

export function db(): DbClient {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL é obrigatória (server-side).');
  const pool = new pg.Pool({
    connectionString,
    // Cada instância do Cloud Run abre no máximo isto; o Cloud SQL tem teto de conexões.
    max: Number(process.env.DB_POOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
    types: pgTypes(pg.types),
  });
  client = createPgDb(pool);
  return client;
}
