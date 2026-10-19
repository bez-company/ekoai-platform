// client.js: monta o cliente (from, query, transaction, withUser) sobre um executor.

import { Query } from './query.js';
import { createSchemaCache } from './schema.js';

function build(query, transaction, schemaCache) {
  const ctx = { query, schema: schemaCache };
  const client = {
    from: (table) => new Query(ctx, table),
    query,
  };

  if (transaction) {
    // As consultas do callback saem na mesma conexão e na mesma transação.
    client.transaction = (fn) => transaction((txQuery) => fn(build(txQuery, null, schemaCache)));
    // `app.user_id` vale só na transação (set_config local): é o que `app.current_user_id()`
    // lê nas policies (ADR 0007). O papel do banco precisa ser o da aplicação, sem bypass.
    client.withUser = (userId, fn) =>
      client.transaction(async (tx) => {
        await tx.query("select set_config('app.user_id', $1, true)", [userId]);
        return fn(tx);
      });
  }
  return client;
}

export function createDb({ query, transaction, schema = 'public' }) {
  return build(query, transaction, createSchemaCache(query, schema));
}
