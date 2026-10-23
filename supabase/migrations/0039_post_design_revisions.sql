-- 0039_post_design_revisions.sql: uma revisão imutável por versão do design de um post (SPEC 019,
-- BEZ-267; ADR 0020). Cada Confirmar do ajuste rápido grava uma linha com o design completo da
-- versão, o diff contra a versão de origem (campo, operação, antes, depois, contexto), o autor e o
-- resumo. A chave única (tenant_id, post_design_id, version) é o controle de versão: quem perde a
-- corrida recebe violação de unicidade, que a rota devolve como 409. Só guarda parâmetros: o PNG de
-- cada versão se redesenha do design. Só o servidor grava (como post_designs).
--
-- Aditivo e reaplicável (o CI roda duas vezes). Nada é apagado; sem -- allow-destructive.

create table if not exists post_design_revisions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references tenants(id) on delete cascade,
  post_design_id  uuid not null,
  version         integer not null check (version >= 1),
  parent_version  integer check (parent_version is null or (parent_version >= 1 and parent_version < version)),
  source          text not null check (source in ('initial', 'edit', 'layout', 'restore')),
  author_id       uuid references users(id) on delete set null,
  design          jsonb not null check (jsonb_typeof(design) = 'object' and pg_column_size(design) <= 65536),
  diff            jsonb not null default '[]'::jsonb check (jsonb_typeof(diff) = 'array' and jsonb_array_length(diff) <= 50 and pg_column_size(diff) <= 16384),
  summary         text not null check (length(summary) between 1 and 160),
  created_at      timestamptz not null default now(),
  unique (tenant_id, post_design_id, version),
  -- a v1 é a geração (sem versão de origem); toda outra versão parte de uma anterior
  check ((version = 1) = (parent_version is null))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'post_design_revisions_design_fk') then
    alter table post_design_revisions add constraint post_design_revisions_design_fk
      foreign key (tenant_id, post_design_id) references post_designs (tenant_id, id) on delete cascade;
  end if;
end $$;

create index if not exists post_design_revisions_design_idx on post_design_revisions (tenant_id, post_design_id, version desc);

-- Revisão é imutável: nenhuma linha muda depois de gravada. A única exceção é o `on delete set null` do
-- autor (excluir a pessoa não pode ser barrado pelo histórico): author_id vira nulo e o resto fica igual.
-- Apagar só pela cascata do post e da conta e pela limpeza de retenção do servidor.
create or replace function app.forbid_revision_update() returns trigger
language plpgsql as $$
begin
  if new.author_id is null and old.author_id is not null
     and (to_jsonb(new) - 'author_id') = (to_jsonb(old) - 'author_id') then
    return new;
  end if;
  raise exception 'post_design_revisions é imutável: grave uma versão nova';
end;
$$;

drop trigger if exists post_design_revisions_immutable on post_design_revisions;
create trigger post_design_revisions_immutable before update on post_design_revisions
  for each row execute function app.forbid_revision_update();

alter table post_design_revisions enable row level security;

drop policy if exists post_design_revisions_select on post_design_revisions;
create policy post_design_revisions_select on post_design_revisions for select to authenticated
  using (app.can(tenant_id, 'content.view'));

revoke all on post_design_revisions from anon, authenticated;
grant select on post_design_revisions to authenticated;
grant all on post_design_revisions to service_role;
