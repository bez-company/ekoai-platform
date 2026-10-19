import pg from 'pg';
import { createPgDb, pgTypes } from '@ekoai/db';

export function testPool() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL ausente: rode `npm run test:db` com um Postgres com as migrations aplicadas');
  return new pg.Pool({ connectionString: url, max: 4, types: pgTypes(pg.types) });
}

export function testDb(pool) {
  return createPgDb(pool);
}
