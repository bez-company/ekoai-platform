-- 0033_vision_calls.sql: teto diário por conta nas chamadas de visão (BEZ-244).
--
-- A legenda pela foto (POST /api/photo-posts/caption, BEZ-236) e a descrição das fotos do banco de
-- imagens (BEZ-198) chamam o modelo de texto com visão. Não contam no limite mensal de posts (SPEC 017,
-- decisão 10), mas não podem gerar custo sem fim: cada chamada reserva uma linha aqui, e um gatilho com
-- lock por conta barra a reserva acima do teto do dia (dia de Brasília). A linha guarda tokens e custo
-- estimado para o painel de custo por conta (BEZ-91). Chamada que falhou libera a vaga.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Tem RLS e entra em TENANT_TABLES.

alter table plans add column if not exists max_photo_captions_per_day integer not null default 50
  check (max_photo_captions_per_day between 0 and 10000);
alter table plans add column if not exists max_media_describes_per_day integer not null default 200
  check (max_media_describes_per_day between 0 and 10000);

create table if not exists vision_calls (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references tenants(id) on delete cascade,
  kind           text not null check (kind in ('photo_caption', 'media_describe')),
  target_id      uuid,
  status         text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  model_version  text check (model_version is null or length(model_version) <= 80),
  input_tokens   integer check (input_tokens is null or input_tokens >= 0),
  output_tokens  integer check (output_tokens is null or output_tokens >= 0),
  cost_usd       numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  error          text check (error is null or length(error) <= 500),
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists vision_calls_day_idx on vision_calls (tenant_id, kind, created_at desc);

create or replace function app.check_vision_cap()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_max  integer;
  v_used integer;
begin
  if new.status = 'failed' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('vision:' || new.tenant_id || ':' || new.kind));
  select case new.kind when 'photo_caption' then p.max_photo_captions_per_day else p.max_media_describes_per_day end
    into v_max
  from public.tenants t join public.plans p on p.id = t.plan_id
  where t.id = new.tenant_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_used from public.vision_calls c
  where c.tenant_id = new.tenant_id and c.kind = new.kind and c.status in ('reserved', 'done')
    and c.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_used >= v_max then
    raise exception 'a conta % chegou ao teto de % chamadas de visão (%) hoje', new.tenant_id, v_max, new.kind
      using errcode = 'check_violation', hint = 'vision_daily';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_vision_cap() from public;

drop trigger if exists vision_calls_cap on vision_calls;
create trigger vision_calls_cap before insert on vision_calls
  for each row execute function app.check_vision_cap();

alter table vision_calls enable row level security;

-- A conta lê o próprio consumo; só o servidor grava (como generation_runs).
drop policy if exists vision_calls_select on vision_calls;
create policy vision_calls_select on vision_calls for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on vision_calls from anon, authenticated;
grant select on vision_calls to authenticated;
grant all on vision_calls to service_role;
