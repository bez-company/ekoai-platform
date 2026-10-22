-- 0029_instagram_post_metrics.sql: métricas do Instagram por post publicado (BEZ-183, base do BEZ-238).
--
-- Reaproveita metrics_snapshots (0001): já é a série temporal por post, com tenant_id (0003) e RLS de
-- leitura para a conta (0012); só jobs gravam. Uma tabela post_metrics nova repetiria as mesmas colunas.
-- Entram as métricas que a Meta passou a devolver em 2025 (`views` no lugar de `impressions`, que saiu
-- da API, e `total_interactions`) e um índice para ler a última coleta de cada post da conta.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table metrics_snapshots add column if not exists views integer check (views is null or views >= 0);
alter table metrics_snapshots add column if not exists total_interactions integer check (total_interactions is null or total_interactions >= 0);

create index if not exists metrics_tenant_post_idx on metrics_snapshots (tenant_id, post_id, captured_at desc);
