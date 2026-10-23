-- 0035_rate_limits.sql: limite de taxa nas rotas públicas de entrada (BEZ-29), antes de abrir
-- SIGNUP_MODE=open em produção. Guardado no próprio Postgres, sem serviço novo.
--
-- Janela fixa por (balde, chave): o balde diz a rota e o tipo de chave (ip ou e-mail), a chave vai como
-- hash SHA-256 (nem IP nem e-mail ficam no banco). app.rate_limit_hit soma 1 de forma atômica e diz se
-- passou do teto e em quantos segundos a janela vira. Linhas velhas saem de vez em quando, na própria
-- chamada. Sem tenant_id de propósito: quem chama ainda não tem conta.
--
-- Aditivo e reaplicável (o CI roda duas vezes).
-- allow-destructive: o único `delete` é a limpeza dentro de app.rate_limit_hit, que apaga contadores
-- vencidos há mais de 2 dias (só hash e número, nenhum dado de pessoa nem de conta). A migration em si não
-- apaga nada.

create table if not exists rate_limit_hits (
  bucket        text not null check (bucket ~ '^[a-z][a-z_.]{1,39}$'),
  key_hash      text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start  timestamptz not null,
  hits          integer not null default 0 check (hits >= 0),
  primary key (bucket, key_hash, window_start)
);

create index if not exists rate_limit_hits_window_idx on rate_limit_hits (window_start);

alter table rate_limit_hits enable row level security;
revoke all on rate_limit_hits from anon, authenticated;
grant all on rate_limit_hits to service_role;

create or replace function app.rate_limit_hit(p_bucket text, p_key_hash text, p_window_s integer, p_limit integer)
returns table (allowed boolean, hits integer, retry_after_s integer)
language plpgsql set search_path = ''
as $$
declare
  v_start timestamptz;
  v_hits  integer;
begin
  if p_window_s < 1 or p_limit < 1 then
    raise exception 'janela e teto precisam ser positivos' using errcode = 'check_violation';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.rate_limit_hits as r (bucket, key_hash, window_start, hits)
  values (p_bucket, p_key_hash, v_start, 1)
  on conflict (bucket, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  -- Limpeza de vez em quando: a janela mais longa é de 1 dia.
  if random() < 0.02 then
    delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  end if;
  return query select v_hits <= p_limit, v_hits,
    greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_s) - now()))))::integer;
end;
$$;

revoke execute on function app.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, text, integer, integer) to service_role;
