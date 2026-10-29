-- 0056_platform_pricing.sql: a política de preço da plataforma, em uma linha só (SPEC 031). Aditivo e reaplicável.
-- A margem NUNCA entra no repositório (é público): os números são gravados pelo console, não por esta migration. A linha nasce zerada, o que
-- quer dizer "preço ainda não definido": o Console › Financeiro pede para definir e não mostra cobrança prevista nem lucro.
--   markup_percent: quanto acima do custo real a plataforma cobra (300 = o preço é 4 vezes o custo)
--   minimum_per_post_brl: preço mínimo de um post, em reais
--   round_up_to_brl: arredonda o preço de cada post para cima neste passo (0 = não arredonda)
--   target_margin_percent: a margem-alvo sobre o preço; o console destaca o que ficar abaixo dela

create table if not exists platform_pricing (
  singleton              boolean primary key default true check (singleton),
  markup_percent         numeric(8, 2) not null default 0 check (markup_percent >= 0 and markup_percent <= 100000),
  minimum_per_post_brl   numeric(8, 2) not null default 0 check (minimum_per_post_brl >= 0 and minimum_per_post_brl <= 10000),
  round_up_to_brl        numeric(6, 2) not null default 0 check (round_up_to_brl >= 0 and round_up_to_brl <= 100),
  target_margin_percent  numeric(5, 2) not null default 0 check (target_margin_percent >= 0 and target_margin_percent < 100),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references users(id) on delete set null
);

insert into platform_pricing (singleton) values (true) on conflict (singleton) do nothing;

-- Sem policy, como platform_admins: nem a API nem uma conta de cliente lê ou grava aqui. Só o servidor, pelo console.
alter table platform_pricing enable row level security;
revoke all on platform_pricing from anon, authenticated;
revoke all on platform_pricing from service_role;
grant select, insert, update on platform_pricing to service_role;
