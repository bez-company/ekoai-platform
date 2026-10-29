-- 0058_platform_fx_rates.sql: a taxa de câmbio de cada mês, em reais por dólar (BEZ-475). Aditivo e reaplicável.
-- O Google Cloud converte o preço em dólar por uma taxa própria, definida no início de cada mês (não é a cotação comercial). O console grava aqui
-- o `currency_conversion_rate` do export de billing; o custo de cada mês usa a taxa dele. Sem linha nenhuma, vale o arquivo pricing.json.

create table if not exists platform_fx_rates (
  month       text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  usd_brl     numeric(10, 4) not null check (usd_brl >= 0.5 and usd_brl <= 50),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null
);

-- Sem policy, como platform_pricing: nem a API nem uma conta de cliente lê ou grava aqui. Só o servidor, pelo console.
alter table platform_fx_rates enable row level security;
revoke all on platform_fx_rates from anon, authenticated;
revoke all on platform_fx_rates from service_role;
grant select, insert, update on platform_fx_rates to service_role;
