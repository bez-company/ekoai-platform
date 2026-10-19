// schema.js: colunas e chave primária de cada tabela, lidas uma vez do catálogo do Postgres.
// Servem a duas coisas: só identificador que existe entra no SQL (nome de tabela e coluna vêm
// de código, mas nunca é interpolado sem conferir) e cada valor é serializado pelo tipo da coluna
// (jsonb recebe JSON, text[] recebe array), que é o que o PostgREST fazia por baixo.

import { makeError } from './errors.js';

export const IDENT = /^[a-z_][a-z0-9_]*$/;

const COLUMNS_SQL = `
  select column_name, udt_name
  from information_schema.columns
  where table_schema = $1 and table_name = $2`;

const PRIMARY_KEY_SQL = `
  select a.attname as column_name
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = to_regclass($1) and i.indisprimary
  order by array_position(i.indkey::int2[], a.attnum)`;

export function kindOf(udt) {
  if (udt === 'json' || udt === 'jsonb') return 'json';
  if (udt.startsWith('_')) return 'array';
  return 'scalar';
}

export function createSchemaCache(query, schema) {
  const tables = new Map();

  async function load(table) {
    if (!IDENT.test(table)) throw new Error(`nome de tabela inválido: ${String(table)}`);
    const [cols, pk] = await Promise.all([
      query(COLUMNS_SQL, [schema, table]),
      query(PRIMARY_KEY_SQL, [`"${schema}"."${table}"`]),
    ]);
    if (cols.rows.length === 0) {
      return { error: makeError(`relation "${schema}.${table}" does not exist`, '42P01') };
    }
    return {
      table,
      columns: new Map(cols.rows.map((r) => [r.column_name, kindOf(r.udt_name)])),
      primaryKey: pk.rows.map((r) => r.column_name),
    };
  }

  return {
    // Falha de tabela não fica em cache: a migration pode ter acabado de criá-la.
    async get(table) {
      let entry = tables.get(table);
      if (!entry) {
        entry = await load(table);
        if (!entry.error) tables.set(table, entry);
      }
      return entry;
    },
  };
}
