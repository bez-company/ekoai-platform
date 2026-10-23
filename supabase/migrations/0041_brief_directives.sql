-- 0041_brief_directives.sql: instruções explícitas do pedido (SPEC 020, ADR 0022).
-- O leitor de instruções lê o pedido uma vez e guarda o resultado no próprio pedido: `directives` é
-- { status: 'ok' | 'failed', directives: {...} } e passa pelo parser puro antes de gravar. A chamada do leitor
-- é uma etapa nova em generation_runs (`directives`), idempotente por hash como as outras.
-- Aditivo e reaplicável (o CI roda duas vezes): a constraint é recriada com o mesmo nome.

alter table briefs add column if not exists directives jsonb
  check (directives is null or pg_column_size(directives) <= 16384);

alter table generation_runs drop constraint if exists generation_runs_step_check;
alter table generation_runs add constraint generation_runs_step_check
  check (step in ('directives', 'strategist', 'writer', 'art', 'visual', 'review', 'render'));
