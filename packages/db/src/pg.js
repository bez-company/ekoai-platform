// pg.js: cola entre um Pool do `pg` e o createDb, sem importar o `pg`.

import { createDb } from './client.js';

// O PostgREST devolvia timestamp como ISO 8601 e inteiro de 64 bits como número; o `pg` devolve
// Date e string. O código foi escrito para o primeiro formato. `numeric` continua string (o
// código já converte com Number()).
const TIMESTAMPTZ = 1184;
const TIMESTAMP = 1114;
const DATE = 1082;
const INT8 = 20;

const parsers = {
  [TIMESTAMPTZ]: (text) => text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'),
  [TIMESTAMP]: (text) => text.replace(' ', 'T'),
  [DATE]: (text) => text,
  [INT8]: (text) => (Number.isSafeInteger(Number(text)) ? Number(text) : text),
};

// Passe o resultado em `new Pool({ types: pgTypes(pg.types) })`.
export function pgTypes(types) {
  return {
    getTypeParser(oid, format) {
      const custom = parsers[oid];
      return custom && (format === undefined || format === 'text') ? custom : types.getTypeParser(oid, format);
    },
  };
}

export function pgExecutor(pool) {
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn((text, params) => client.query(text, params));
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export function createPgDb(pool, options = {}) {
  return createDb({ ...pgExecutor(pool), ...options });
}
