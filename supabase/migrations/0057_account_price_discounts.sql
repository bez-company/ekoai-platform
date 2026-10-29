-- 0057_account_price_discounts.sql: desconto de preço por conta (SPEC 032). Aditivo e reaplicável.
-- Um desconto é uma linha com período: nunca é editado, só encerrado (ends_on) e substituído por outro, para o preço de posts de períodos
-- anteriores não mudar. Só o console grava e lê.
-- A coluna da conta chama-se account_id, e NÃO tenant_id, de propósito: tabela com tenant_id entra em TENANT_TABLES e na exportação de dados
-- que o cliente baixa (LGPD), e o desconto dado a uma conta não pode sair por ali.

create table if not exists account_price_discounts (
  id               uuid primary key default gen_random_uuid(),
  account_id       text not null references tenants(id) on delete cascade,
  discount_percent numeric(5, 2) not null check (discount_percent > 0 and discount_percent <= 100),
  reason           text not null check (char_length(reason) between 3 and 200),
  starts_on        date not null,
  ends_on          date check (ends_on is null or ends_on >= starts_on),
  created_at       timestamptz not null default now(),
  created_by       uuid references users(id) on delete set null
);

create index if not exists account_price_discounts_account_idx on account_price_discounts (account_id, starts_on desc);

-- Sem policy, como platform_pricing: nem a API nem uma conta de cliente lê ou grava aqui. Só o servidor, pelo console.
alter table account_price_discounts enable row level security;
revoke all on account_price_discounts from anon, authenticated;
revoke all on account_price_discounts from service_role;
grant select, insert, update, delete on account_price_discounts to service_role;
