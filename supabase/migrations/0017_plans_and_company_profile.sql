-- 0017_plans_and_company_profile.sql: planos com limite, tipo da conta e perfil da empresa
-- (SPEC 011 R2, R3 e R7).
--
-- 1. plans: limites por plano (pessoas e contas de Instagram). Sem preço nem cobrança.
-- 2. tenants.kind e tenants.plan_id: pessoa ou empresa, e o plano. Um gatilho garante que o plano
--    é do mesmo tipo da conta (conta pessoa não ganha o plano de 5 pessoas).
-- 3. company_profiles: o perfil da empresa (nicho, o que vende, voz, visual, preferências), uma
--    linha por conta. Guardado agora, usado pelos agentes da fase 2. Os limites de tamanho e
--    formato valem no banco; as listas fechadas (nicho, fontes) são validadas no servidor.
-- 4. brand_assets: o arquivo do logo (o binário mora no bucket privado, ADR 0009).
-- 5. Permissões novas: profile.view (ver o perfil) e channels.view (ver as redes conectadas).
--    Quem edita o perfil continua sendo brand.manage; as redes, channels.manage.
--
-- A matriz de papéis foi semeada na 0015, que a reescreve inteira a cada aplicação. Estas linhas
-- entram depois dela, então a ordem das migrations as mantém.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Planos
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists plans (
  id                      text primary key check (id ~ '^[a-z][a-z0-9-]{1,29}$'),
  name                    text not null check (length(trim(name)) > 0),
  kind                    text not null check (kind in ('pessoa', 'empresa')),
  max_seats               integer not null check (max_seats between 1 and 1000),
  max_instagram_accounts  integer not null check (max_instagram_accounts between 0 and 100),
  created_at              timestamptz not null default now()
);

insert into plans (id, name, kind, max_seats, max_instagram_accounts) values
  ('pessoa',  'Pessoa',  'pessoa',  1, 1),
  ('inicial', 'Inicial', 'empresa', 5, 1)
on conflict (id) do nothing;

alter table plans enable row level security;
drop policy if exists plans_select on plans;
create policy plans_select on plans for select to authenticated using (true);
revoke all on plans from anon, authenticated;
grant select on plans to authenticated;
grant all on plans to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tipo da conta e plano
-- ─────────────────────────────────────────────────────────────────────────────
alter table tenants add column if not exists kind text not null default 'empresa' check (kind in ('pessoa', 'empresa'));
alter table tenants add column if not exists plan_id text not null default 'inicial' references plans(id);

create or replace function app.check_tenant_plan()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.plans p where p.id = new.plan_id and p.kind = new.kind) then
    raise exception 'o plano % não é de uma conta do tipo %', new.plan_id, new.kind
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_tenant_plan() from public;

drop trigger if exists tenants_check_plan on tenants;
create trigger tenants_check_plan before insert or update of kind, plan_id on tenants
  for each row execute function app.check_tenant_plan();

create or replace function app.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.touch_updated_at() from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Logo da marca
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists brand_assets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references tenants(id) on delete cascade,
  kind          text not null check (kind in ('logo')),
  storage_path  text not null check (
    length(storage_path) <= 300 and storage_path like 'tenants/' || tenant_id || '/%' and storage_path !~ '\.\.'
  ),
  content_type  text not null check (content_type in ('image/png', 'image/svg+xml')),
  byte_size     integer not null check (byte_size between 1 and 2097152),
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Perfil da empresa
-- ─────────────────────────────────────────────────────────────────────────────
-- Uma linha por conta, criada no passo 2 do cadastro (nicho, o que vende e para quem são
-- obrigatórios). A FK composta impede que o perfil aponte para o logo de outra conta; o logo só
-- sai depois de o perfil deixar de apontar para ele.
create table if not exists company_profiles (
  tenant_id         text primary key references tenants(id) on delete cascade,
  niche             text not null check (length(trim(niche)) between 1 and 80),
  offering          text not null check (length(trim(offering)) between 1 and 280),
  audience          text not null check (length(trim(audience)) between 1 and 280),
  region            text check (region is null or length(region) <= 80),
  site_url          text check (site_url is null or (length(site_url) <= 200 and site_url ~* '^https?://')),
  instagram_handle  text check (instagram_handle is null or instagram_handle ~ '^@?[A-Za-z0-9._]{1,30}$'),
  differentiators   text[] not null default '{}' check (cardinality(differentiators) <= 5 and length(array_to_string(differentiators, E'\n')) <= 750),
  pains             text[] not null default '{}' check (cardinality(pains) <= 5 and length(array_to_string(pains, E'\n')) <= 750),
  voice_formal      smallint check (voice_formal between 1 and 5),
  voice_technical   smallint check (voice_technical between 1 and 5),
  voice_serious     smallint check (voice_serious between 1 and 5),
  banned_words      text[] not null default '{}' check (cardinality(banned_words) <= 30 and length(array_to_string(banned_words, E'\n')) <= 600),
  logo_asset_id     uuid,
  color_primary     text check (color_primary is null or color_primary ~ '^#[0-9A-Fa-f]{6}$'),
  color_accent      text check (color_accent is null or color_accent ~ '^#[0-9A-Fa-f]{6}$'),
  font_heading      text check (font_heading is null or length(font_heading) <= 40),
  font_body         text check (font_body is null or length(font_body) <= 40),
  cta_default       text check (cta_default is null or cta_default in ('link_bio', 'whatsapp', 'dm')),
  posts_per_week    smallint check (posts_per_week is null or posts_per_week between 1 and 14),
  updated_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, logo_asset_id) references brand_assets (tenant_id, id)
);

drop trigger if exists company_profiles_touch on company_profiles;
create trigger company_profiles_touch before update on company_profiles
  for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Permissões novas e RLS
-- ─────────────────────────────────────────────────────────────────────────────
insert into role_permissions (role, permission) values
  ('admin',   'profile.view'),
  ('creator', 'profile.view'),
  ('admin',   'channels.view'),
  ('creator', 'channels.view')
on conflict do nothing;

alter table brand_assets     enable row level security;
alter table company_profiles enable row level security;

-- O perfil e o logo: admin e criador veem; só quem tem brand.manage escreve. O leitor não vê.
drop policy if exists profile_select on company_profiles;
create policy profile_select on company_profiles for select to authenticated using (app.can(tenant_id, 'profile.view'));
drop policy if exists profile_insert on company_profiles;
create policy profile_insert on company_profiles for insert to authenticated with check (app.can(tenant_id, 'brand.manage'));
drop policy if exists profile_update on company_profiles;
create policy profile_update on company_profiles for update to authenticated
  using (app.can(tenant_id, 'brand.manage')) with check (app.can(tenant_id, 'brand.manage'));

drop policy if exists brand_assets_select on brand_assets;
create policy brand_assets_select on brand_assets for select to authenticated using (app.can(tenant_id, 'profile.view'));
drop policy if exists brand_assets_insert on brand_assets;
create policy brand_assets_insert on brand_assets for insert to authenticated with check (app.can(tenant_id, 'brand.manage'));
drop policy if exists brand_assets_delete on brand_assets;
create policy brand_assets_delete on brand_assets for delete to authenticated using (app.can(tenant_id, 'brand.manage'));

revoke all on company_profiles, brand_assets from anon, authenticated;
grant select, insert, update on company_profiles to authenticated;
grant select, insert, delete on brand_assets to authenticated;
grant all on company_profiles, brand_assets to service_role;
