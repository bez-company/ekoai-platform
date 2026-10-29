-- 0059_plan_networks.sql: o plano limita quantas redes a conta conecta (SPEC 021, BEZ-494).
--
-- Individual de 1 rede = 1 (o plano `pessoa`), Individual de 3 redes = 3 (plano novo `pessoa-3`), Time = até 3 (`inicial`).
-- A trava vale no banco, como a do Instagram (0018): é o único lugar que a API e o servidor não contornam. Uma rede conta
-- uma vez, qualquer que seja o número de contas dela (duas contas de Instagram são uma rede só). Conexão que já existe
-- nunca é derrubada: só a rede nova, acima do limite, é recusada.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table plans add column if not exists max_networks integer not null default 1 check (max_networks between 1 and 20);

update plans set max_networks = 3 where id = 'inicial' and max_networks < 3;

-- Mesmos limites do `pessoa`, só com 3 redes.
insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month, max_photo_captions_per_day, max_media_describes_per_day, max_networks)
select 'pessoa-3', 'Pessoa, 3 redes', kind, max_seats, max_instagram_accounts, max_posts_per_month, max_photo_captions_per_day, max_media_describes_per_day, 3
from plans where id = 'pessoa'
on conflict (id) do nothing;

create or replace function app.check_network_limit()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_max  integer;
  v_used integer;
begin
  if new.status = 'revoked' then
    return new;
  end if;
  -- Uma conexão que já contava (ativa ou pedindo reconexão) só muda de estado: não abre rede nova.
  if tg_op = 'UPDATE' and old.status <> 'revoked' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('networks:' || new.tenant_id));
  select p.max_networks into v_max
  from public.tenants t join public.plans p on p.id = t.plan_id
  where t.id = new.tenant_id;
  if v_max is null then
    return new;
  end if;
  -- A rede que já está conectada por outra linha (outra conta do mesmo canal) não abre rede nova.
  if exists (
    select 1 from public.social_accounts s
    where s.tenant_id = new.tenant_id and s.channel = new.channel and s.status <> 'revoked' and s.id <> new.id
  ) then
    return new;
  end if;
  select count(distinct s.channel) into v_used from public.social_accounts s
  where s.tenant_id = new.tenant_id and s.status <> 'revoked' and s.id <> new.id;
  if v_used >= v_max then
    raise exception 'o plano da conta % permite % rede(s) e o limite foi atingido', new.tenant_id, v_max
      using errcode = 'check_violation', hint = 'plan_networks';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_network_limit() from public;

drop trigger if exists social_accounts_network_limit on social_accounts;
create trigger social_accounts_network_limit before insert or update of status on social_accounts
  for each row execute function app.check_network_limit();
