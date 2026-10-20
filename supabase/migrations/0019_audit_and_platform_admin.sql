-- 0019_audit_and_platform_admin.sql: registro de auditoria só de inserção e o administrador da
-- plataforma (SPEC 011 R4, R8 e R9; docs/arquitetura/ultra-admin.md).
--
-- 1. audit_events: quem fez o quê numa conta (mudança de equipe, conexão de rede, exclusão...).
--    Só aceita inserção: update e delete falham para qualquer papel, inclusive o dono da tabela.
--    Sem FK para a conta de propósito: o registro sobrevive à exclusão dela (a exclusão da conta
--    grava o próprio evento). Apagar por prazo de retenção vira uma migration revisada.
-- 2. platform_admins: o administrador da plataforma (o dono do produto), no máximo uma linha, fora
--    da matriz de papéis das contas. Sem policy e sem acesso da API. O e-mail NÃO entra no
--    repositório (é público): a linha é gravada por uma operação de sistema, nunca por uma tela.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Auditoria
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists audit_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text,
  actor_user_id  uuid,
  actor_kind     text not null default 'user' check (actor_kind in ('user', 'platform_admin', 'system')),
  action         text not null check (length(action) <= 80 and action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  target_type    text check (target_type is null or length(target_type) <= 40),
  target_id      text check (target_id is null or length(target_id) <= 100),
  metadata       jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  ip             inet,
  created_at     timestamptz not null default now()
);

create index if not exists audit_events_tenant_idx on audit_events (tenant_id, created_at desc);

create or replace function app.audit_append_only()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_events só aceita inserção' using errcode = 'insufficient_privilege';
end;
$$;
revoke execute on function app.audit_append_only() from public;

drop trigger if exists audit_events_append_only on audit_events;
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function app.audit_append_only();

alter table audit_events enable row level security;
drop policy if exists audit_events_select on audit_events;
create policy audit_events_select on audit_events for select to authenticated using (app.can(tenant_id, 'audit.view'));

revoke all on audit_events from anon, authenticated;
grant select on audit_events to authenticated;
revoke all on audit_events from service_role;
grant select, insert on audit_events to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Administrador da plataforma
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists platform_admins (
  singleton   boolean primary key default true check (singleton),
  user_id     uuid not null unique references users(id) on delete restrict,
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  granted_at  timestamptz not null default now()
);

-- Sem policy: nem a API nem uma conta de cliente lê ou grava aqui. Só o servidor lê (para conferir
-- o portão do console) e a operação de sistema grava ou revoga; nada atualiza a linha.
alter table platform_admins enable row level security;
revoke all on platform_admins from anon, authenticated;
revoke all on platform_admins from service_role;
grant select, insert, delete on platform_admins to service_role;
