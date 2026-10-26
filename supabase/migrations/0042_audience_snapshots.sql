-- 0042_audience_snapshots.sql: leitura diária do público da conta (SPEC 022, BEZ-206).
-- Uma linha por conta, rede e dia: faixa etária e gênero dos seguidores (follower_demographics) e, quando a Meta
-- devolve, a fração de seguidores online por hora (online_followers). Só agregados da Meta (faixas e
-- percentuais): nenhum seguidor individual é lido nem guardado. `status` diz por que um campo veio vazio
-- (sem permissão de insights, menos de 100 seguidores, resposta fora do formato), para a tela explicar.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Nada é apagado; sem -- allow-destructive.

create table if not exists audience_snapshots (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null references tenants(id) on delete cascade,
  channel      text not null check (channel in ('instagram')),
  captured_on  date not null,
  followers    integer check (followers is null or followers >= 0),
  age          jsonb check (age is null or (jsonb_typeof(age) = 'object' and pg_column_size(age) <= 2048)),
  gender       jsonb check (gender is null or (jsonb_typeof(gender) = 'object' and pg_column_size(gender) <= 1024)),
  online_hours jsonb check (online_hours is null or (jsonb_typeof(online_hours) = 'array' and jsonb_array_length(online_hours) = 24 and pg_column_size(online_hours) <= 1024)),
  status       text not null check (status in ('ok', 'no_permission', 'too_few_followers', 'unavailable')),
  raw          jsonb not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object' and pg_column_size(raw) <= 16384),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, channel, captured_on)
);

create index if not exists audience_snapshots_tenant_idx on audience_snapshots (tenant_id, channel, captured_on desc);

drop trigger if exists audience_snapshots_touch on audience_snapshots;
create trigger audience_snapshots_touch before update on audience_snapshots
  for each row execute function app.touch_updated_at();

alter table audience_snapshots enable row level security;

-- Quem é da conta lê o público, como lê metrics_snapshots; só o servidor grava.
drop policy if exists tenant_select on audience_snapshots;
create policy tenant_select on audience_snapshots for select to authenticated using (app.is_tenant_member(tenant_id));

revoke all on audience_snapshots from anon, authenticated;
grant select on audience_snapshots to authenticated;
grant all on audience_snapshots to service_role;
