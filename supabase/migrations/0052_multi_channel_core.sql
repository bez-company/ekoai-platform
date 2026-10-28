-- 0052_multi_channel_core.sql: um pedido, um post por rede (SPEC 028, BEZ-424). Aditivo e reaplicável (o CI roda duas vezes).
-- `briefs.channels`: onde a pessoa quer publicar (padrão: só o Instagram, o que existia). `briefs.core`: o núcleo da ideia
-- (ângulo, pontos, fato que prova, pergunta), que o redator de cada rede lê no lugar da legenda de outra rede.
-- `pending_approvals.visual_mode`: se a variante usa a arte do pedido, uma própria ou nenhuma.
-- `generation_runs.channel` e os passos novos (core, adapt, critic, fix, publish) deixam registrar todo o custo por etapa e por rede.

alter table briefs add column if not exists channels text[] not null default '{instagram}'
  check (cardinality(channels) between 1 and 3 and channels <@ array['instagram', 'linkedin', 'twitter']::text[]);

alter table briefs add column if not exists core jsonb
  check (core is null or (jsonb_typeof(core) = 'object' and pg_column_size(core) <= 8192));

alter table pending_approvals add column if not exists visual_mode text
  check (visual_mode is null or visual_mode in ('shared', 'own', 'none'));

alter table generation_runs add column if not exists channel text
  check (channel is null or channel in ('instagram', 'linkedin', 'twitter'));

alter table generation_runs drop constraint if exists generation_runs_step_check;
alter table generation_runs add constraint generation_runs_step_check
  check (step in ('directives', 'strategist', 'writer', 'core', 'adapt', 'art', 'visual', 'review', 'critic', 'fix', 'render', 'publish'));
