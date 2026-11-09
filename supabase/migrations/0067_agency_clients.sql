-- 0067_agency_clients.sql: a agência e as contas dos clientes dela (SPEC 039, ADR 0032, BEZ-265).
--
-- Cada cliente da agência é uma conta da Ekoai como outra qualquer (marca, fatos, regras, agenda e o Instagram dela), com
-- `tenants.agency_id` apontando para a conta da agência. A conta da agência está no plano `agencia`, que só o console do
-- administrador da plataforma liga. Não há limite de clientes: a cobrança será por marca (SPEC 021), não por teto.
--
-- Regras no banco (o único lugar que a API e o servidor não contornam):
--   - o cliente aponta para uma conta no plano `agencia`, que não é cliente de ninguém (um nível só);
--   - uma conta no plano `agencia` não é cliente de outra;
--   - a agência não sai do plano `agencia` enquanto tiver clientes.
--
-- Aditivo e reaplicável (o CI roda duas vezes). `tenants` não tem tenant_id (a linha é a própria conta): nada entra em TENANT_TABLES.

-- O plano da agência: os mesmos limites do `inicial` (Time) para a conta da própria agência.
insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month, max_photo_captions_per_day, max_media_describes_per_day, max_networks)
select 'agencia', 'Agência', 'empresa', max_seats, max_instagram_accounts, max_posts_per_month, max_photo_captions_per_day, max_media_describes_per_day, max_networks
from plans where id = 'inicial'
on conflict (id) do nothing;

-- Apagar a agência não apaga os clientes: cada um vira uma conta solta, com os dados dela.
alter table tenants add column if not exists agency_id text references tenants(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_agency_not_self') then
    alter table tenants add constraint tenants_agency_not_self check (agency_id is null or agency_id <> id);
  end if;
end;
$$;

create index if not exists tenants_agency_idx on tenants (agency_id) where agency_id is not null;

create or replace function app.check_tenant_agency()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.agency_id is not null then
    if new.plan_id = 'agencia' then
      raise exception 'a conta % é agência e não pode ser cliente de outra', new.id
        using errcode = 'check_violation', hint = 'agency_nested';
    end if;
    -- A trava da linha da agência segura a corrida com quem tira o plano dela ao mesmo tempo.
    perform 1 from public.tenants a where a.id = new.agency_id for share;
    if not exists (select 1 from public.tenants a where a.id = new.agency_id and a.plan_id = 'agencia' and a.agency_id is null) then
      raise exception 'a conta % não é uma agência', new.agency_id
        using errcode = 'check_violation', hint = 'agency_not_agency';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.plan_id = 'agencia' and new.plan_id <> 'agencia'
     and exists (select 1 from public.tenants c where c.agency_id = new.id) then
    raise exception 'a agência % tem clientes e não pode sair do plano', new.id
      using errcode = 'check_violation', hint = 'agency_has_clients';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_tenant_agency() from public;

drop trigger if exists tenants_check_agency on tenants;
create trigger tenants_check_agency before insert or update of agency_id, plan_id on tenants
  for each row execute function app.check_tenant_agency();
