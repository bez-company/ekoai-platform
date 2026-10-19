// @ekoai/db: acesso ao Postgres no formato do supabase-js, sobre um executor injetado.
//
//   const db = createDb({ query, transaction });
//   const { data, error } = await db.from('posts').select('id').eq('tenant_id', t).limit(10);
//
// `query(text, params)` devolve `{ rows }`. O pacote não importa `pg`: quem usa cria o Pool e
// entrega o executor (veja pg.js), o que mantém a raiz (Node puro) e a plataforma (Next) com a
// mesma lógica sem brigar por resolução de módulo.

export { createDb } from './client.js';
export { pgTypes, pgExecutor, createPgDb } from './pg.js';
