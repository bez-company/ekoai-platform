# ADR 0008: acesso ao Postgres por um pacote próprio sobre `pg`

- **Status:** aceito
- **Data:** 2026-10-19
- **Specs que dependem:** [SPEC 010](../specs/010-migracao-google-cloud.md) (fase 1)
- **Ajusta:** a decisão D2 da SPEC 010 ("`pg` + Kysely")

## Contexto

O código acessava o banco por `supabase-js`: 101 chamadas `.from()` em 19 arquivos, na raiz (jobs,
Node puro) e na plataforma (Next, TypeScript). No Cloud SQL não existe PostgREST, então o cliente
precisa trocar. A SPEC propôs Kysely. Ao medir o uso, o vocabulário real é pequeno e uniforme:
`select`, `insert`, `update`, `upsert`, `delete`, `eq neq gt gte lt lte in is not or`, `order`,
`limit`, `range`, `single`, `maybeSingle`, contagem com `head` e caminho em jsonb (`funnel->ativados`).
Todas as consultas são de tabela única e nenhuma usa join embutido.

## Decisão

1. **Pacote `@ekoai/db` (`packages/db`)** com um construtor de consulta no mesmo formato do
   supabase-js, sobre um executor `query(texto, parâmetros)` injetado. Resolve `{ data, error, count }`
   e nunca rejeita por erro de banco. Sem dependência de runtime: a raiz e a plataforma criam cada
   uma o `Pool` do `pg` e entregam o executor.
2. **Kysely fica de fora.** A camada é dinâmica por tabela (`tenantDb(...).select(tabela)`), então
   Kysely não daria tipo útil; e reescrever 101 chamadas para outra forma trocaria cliente e
   comportamento ao mesmo tempo. Mantendo a forma, a migração é troca de import e o risco cai.
3. **Segurança por construção:** todo valor vai por parâmetro; tabela e coluna só entram no SQL se
   existirem no catálogo do Postgres (lido uma vez por tabela) e passam por aspas; `update` e
   `delete` sem filtro são recusados; formas fora do subconjunto (select com embed, `or` aninhado)
   falham alto em vez de gerar SQL errado.
4. **Compatibilidade de formato:** `timestamptz` volta como ISO 8601, `bigint` como número, `jsonb`
   e `text[]` são serializados pelo tipo da coluna, erro carrega o código do Postgres (42703, 23505,
   23503), que o código chamador já usa.
5. **`withUser(userId, fn)`** abre uma transação com `set_config('app.user_id', ..., true)`. É o
   caminho do ADR 0007 para o acesso com RLS por pessoa; hoje o app ainda acessa como dono das
   tabelas e o isolamento vem do `tenantDb`.

## Consequências

- O pacote é código nosso para manter (cerca de 550 linhas, 12 testes de SQL e 24 contra Postgres
  real). Se o produto passar a precisar de join ou consulta tipada, Kysely entra ao lado, tabela a
  tabela, sem desfazer isto.
- `@ekoai/db` é ligado por `file:` (raiz e plataforma). O build da plataforma e os Dockerfiles
  partem da raiz do repo.
- O teste `tests/db/` (`npm run test:db`) roda contra um Postgres e é job do CI.
