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

// Apaga os dados de todos os tenants (menos a tabela `tenants`) e os tenants de teste. Só roda num
// banco de teste: o nome do banco precisa conter "test", porque aqui se limpa tabela inteira.
export async function resetTenantData(pool, tenantIds = []) {
  const { rows: [{ name }] } = await pool.query('select current_database() as name');
  if (!name.includes('test')) throw new Error(`recuso limpar o banco "${name}": o nome precisa conter "test"`);
  const { rows } = await pool.query(`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'`);
  const tables = rows.map((r) => `public."${r.table_name}"`).join(', ');
  await pool.query(`truncate ${tables} restart identity cascade`);
  await pool.query("delete from users where email like 'it-%@example.test'");
  if (tenantIds.length) await pool.query('delete from tenants where id = any($1)', [tenantIds]);
}
