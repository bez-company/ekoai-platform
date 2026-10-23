-- 0041_tenant_suspension.sql: suspender uma conta pelo console do administrador da plataforma
-- (BEZ-303, SPEC 011 R9, docs/arquitetura/ultra-admin.md).
--
-- `tenants.status` já existe desde a 0012 ('active' | 'suspended') e nada o lia. Agora:
-- 1. suspended_at e suspended_reason guardam quando e por quê (o motivo aparece no console e no registro
--    de auditoria; nunca para quem está de fora).
-- 2. app.due_scheduled_posts passa a ignorar conta suspensa, como já ignora conta pausada: nada é
--    publicado enquanto ela estiver suspensa, mesmo que alguém despause por outro caminho.
--
-- O resto da suspensão (ninguém da conta entra, a fila de geração para) vive no código: session.ts,
-- accounts.ts e generation-worker.ts. Aditivo e reaplicável (o CI roda duas vezes).

alter table tenants add column if not exists suspended_at timestamptz;
alter table tenants add column if not exists suspended_reason text
  check (suspended_reason is null or length(suspended_reason) <= 500);

create or replace function app.due_scheduled_posts(p_now timestamptz, p_limit integer)
returns table (id uuid, tenant_id text)
language sql stable set search_path = ''
as $$
  select r.id, r.tenant_id
  from (
    select sp.id, sp.tenant_id, sp.scheduled_for,
           row_number() over (partition by sp.tenant_id order by sp.scheduled_for, sp.id) as rn
    from public.scheduled_posts sp
    where sp.status = 'scheduled'
      and sp.scheduled_for <= p_now
      and not exists (select 1 from public.publishing_controls pc where pc.tenant_id = sp.tenant_id and pc.paused)
      and not exists (select 1 from public.tenants t where t.id = sp.tenant_id and t.status = 'suspended')
  ) r
  order by r.rn, r.scheduled_for, r.id
  limit greatest(p_limit, 0);
$$;

revoke execute on function app.due_scheduled_posts(timestamptz, integer) from public, anon, authenticated;
grant execute on function app.due_scheduled_posts(timestamptz, integer) to service_role;
