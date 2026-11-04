-- 0064_material_requests.sql: pedidos de material da Ekoai (SPEC 036, BEZ-549).
--
-- Na rodada do coordenador, a regra (sem modelo) pede o que falta para um post sugerido: uma foto real que o banco não
-- tem (kind photo, com a etiqueta pedida) ou a confirmação de um fato que vence logo (kind confirm, com o fato). No
-- máximo 2 abertos por conta (conferido na criação) e nunca dois abertos para a mesma coisa (índice abaixo). Vence no
-- horário do post. A resposta vai para onde já existe: a foto para o banco, a confirmação para o fato. Só o servidor grava.
--
-- Aditivo e reaplicável (o CI roda duas vezes). A tabela tem RLS e entra em TENANT_TABLES.

create table if not exists material_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null references tenants(id) on delete cascade,
  kind              text not null check (kind in ('photo', 'confirm')),
  status            text not null default 'open' check (status in ('open', 'answered', 'dismissed', 'expired')),
  need_tag          text check (need_tag is null or need_tag in ('produto', 'equipe', 'bastidor', 'espaco', 'evento', 'cliente', 'outro')),
  fact_id           uuid references company_facts(id) on delete cascade,
  campaign_id       uuid references campaigns(id) on delete set null,
  suggestion_id     uuid references content_suggestions(id) on delete set null,
  title             text not null check (length(trim(title)) between 1 and 160),
  reason            text not null check (length(trim(reason)) between 1 and 240),
  due_at            timestamptz not null,
  reminded_at       timestamptz,
  answered_at       timestamptz,
  answered_by       uuid references users(id) on delete set null,
  answered_asset_id uuid,
  outcome           text check (outcome is null or outcome in ('photo', 'kept', 'edited', 'off', 'dismissed', 'expired')),
  created_at        timestamptz not null default now(),
  check ((kind = 'photo' and need_tag is not null) or (kind = 'confirm' and fact_id is not null)),
  foreign key (tenant_id, answered_asset_id) references media_assets (tenant_id, id) on delete set null (answered_asset_id)
);

-- Nunca dois pedidos abertos para a mesma foto ou para o mesmo fato.
create unique index if not exists material_requests_open_idx
  on material_requests (tenant_id, kind, coalesce(need_tag, fact_id::text)) where status = 'open';
create index if not exists material_requests_tenant_idx on material_requests (tenant_id, status, due_at);

alter table material_requests enable row level security;

drop policy if exists material_requests_select on material_requests;
create policy material_requests_select on material_requests for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on material_requests from anon, authenticated;
grant select on material_requests to authenticated;
grant all on material_requests to service_role;
