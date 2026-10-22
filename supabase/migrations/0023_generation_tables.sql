-- 0023_generation_tables.sql: banco da geração de posts por agentes (SPEC 012, entrega 3; ADR 0017).
--
-- 1. plans.max_posts_per_month: o limite mensal do plano (20 no plano inicial). O que conta é cada
--    visual gerado pelo modelo de imagem: o primeiro de um post e cada "outra direção". Texto, render
--    e revisão não contam.
-- 2. company_facts: o que a empresa pode afirmar (fato, com a fonte) e o que nunca afirma. O post só
--    sai com número, preço ou claim que esteja aqui.
-- 3. generation_runs: uma linha por chamada de modelo, com reserva e chave de idempotência
--    (conta, pedido, etapa, hash da entrada). Pedido repetido devolve a linha gravada, não chama o
--    modelo e não cobra. O gatilho de limite roda na reserva do visual, com lock por conta: duas
--    gerações ao mesmo tempo no último post, só uma passa.
-- 4. post_designs: o design do post (slots de texto, cores, logo, elementos, visual em cache) para
--    re-renderizar sem IA. pending_approvals e briefs ganham só o vínculo e o tipo do post.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Toda tabela nova tem RLS e entra em TENANT_TABLES.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Limite mensal do plano
-- ─────────────────────────────────────────────────────────────────────────────
alter table plans add column if not exists max_posts_per_month integer not null default 20
  check (max_posts_per_month between 1 and 10000);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fatos da empresa e o que nunca afirmar
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists company_facts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null references tenants(id) on delete cascade,
  kind         text not null check (kind in ('fact', 'never')),
  text         text not null check (length(trim(text)) between 1 and 280),
  source       text not null default 'owner' check (source in ('site', 'owner', 'other')),
  source_note  text check (source_note is null or length(source_note) <= 200),
  active       boolean not null default true,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists company_facts_tenant_idx on company_facts (tenant_id, kind, active);

drop trigger if exists company_facts_touch on company_facts;
create trigger company_facts_touch before update on company_facts
  for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Chamadas de modelo: reserva, idempotência e custo
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists generation_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references tenants(id) on delete cascade,
  brief_id       uuid not null references briefs(id) on delete cascade,
  step           text not null check (step in ('strategist', 'writer', 'art', 'visual', 'review', 'render')),
  input_hash     text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status         text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  model          text check (model is null or length(model) <= 80),
  model_version  text check (model_version is null or length(model_version) <= 80),
  input_tokens   integer check (input_tokens is null or input_tokens >= 0),
  output_tokens  integer check (output_tokens is null or output_tokens >= 0),
  images         integer not null default 0 check (images >= 0),
  cost_usd       numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),
  result         jsonb check (result is null or pg_column_size(result) <= 262144),
  error          text check (error is null or length(error) <= 1000),
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  unique (tenant_id, brief_id, step, input_hash)
);

create index if not exists generation_runs_month_idx on generation_runs (tenant_id, step, created_at desc);

-- O limite mensal vale na reserva do visual. O mês é o do calendário em UTC (o mesmo que a
-- exportação de faturamento do provedor usa). Linha que falhou libera a vaga.
create or replace function app.check_post_limit()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_max  integer;
  v_used integer;
begin
  if new.step <> 'visual' or new.status = 'failed' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('posts:' || new.tenant_id));
  select p.max_posts_per_month into v_max
  from public.tenants t join public.plans p on p.id = t.plan_id
  where t.id = new.tenant_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_used from public.generation_runs r
  where r.tenant_id = new.tenant_id and r.step = 'visual' and r.status in ('reserved', 'done')
    and r.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
    and r.id <> new.id;
  if v_used >= v_max then
    raise exception 'o plano da conta % permite % posts por mês e o limite foi atingido', new.tenant_id, v_max
      using errcode = 'check_violation', hint = 'plan_posts';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_post_limit() from public;

drop trigger if exists generation_runs_post_limit on generation_runs;
create trigger generation_runs_post_limit before insert on generation_runs
  for each row execute function app.check_post_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Design do post e os vínculos
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists post_designs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null references tenants(id) on delete cascade,
  brief_id     uuid not null references briefs(id) on delete cascade,
  kind         text not null check (kind in ('informativo', 'atmosfera')),
  ratio        text not null default '4:5' check (ratio in ('1:1', '4:5')),
  layout       text not null check (layout ~ '^[a-z][a-z0-9-]{1,39}$'),
  design       jsonb not null check (jsonb_typeof(design) = 'object' and pg_column_size(design) <= 65536),
  visual_key   text check (visual_key is null or (length(visual_key) <= 120 and visual_key like 'images/%')),
  visual_hash  text check (visual_hash is null or visual_hash ~ '^[0-9a-f]{64}$'),
  png_key      text check (png_key is null or (length(png_key) <= 120 and png_key like 'images/%')),
  review       jsonb check (review is null or pg_column_size(review) <= 16384),
  version      integer not null default 1 check (version >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);

create index if not exists post_designs_brief_idx on post_designs (tenant_id, brief_id);

drop trigger if exists post_designs_touch on post_designs;
create trigger post_designs_touch before update on post_designs
  for each row execute function app.touch_updated_at();

-- A pendência aponta para o design (FK composta: nunca para o design de outra conta).
alter table pending_approvals add column if not exists post_design_id uuid;
alter table pending_approvals add column if not exists post_kind text
  check (post_kind is null or post_kind in ('informativo', 'atmosfera'));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pending_approvals_post_design_fk') then
    alter table pending_approvals add constraint pending_approvals_post_design_fk
      foreign key (tenant_id, post_design_id) references post_designs (tenant_id, id) on delete set null;
  end if;
end $$;

-- O pedido vindo da plataforma: tipo do post, quem pediu, de onde veio e o erro quando falha.
alter table briefs add column if not exists post_kind text
  check (post_kind is null or post_kind in ('informativo', 'atmosfera'));
alter table briefs add column if not exists source text not null default 'job'
  check (source in ('job', 'platform'));
alter table briefs add column if not exists requested_by uuid references users(id) on delete set null;
alter table briefs add column if not exists error text check (error is null or length(error) <= 500);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS e grants
-- ─────────────────────────────────────────────────────────────────────────────
alter table company_facts   enable row level security;
alter table generation_runs enable row level security;
alter table post_designs    enable row level security;

-- Fatos: quem vê o perfil lê; só quem gere a marca escreve.
drop policy if exists company_facts_select on company_facts;
create policy company_facts_select on company_facts for select to authenticated using (app.can(tenant_id, 'profile.view'));
drop policy if exists company_facts_insert on company_facts;
create policy company_facts_insert on company_facts for insert to authenticated with check (app.can(tenant_id, 'brand.manage'));
drop policy if exists company_facts_update on company_facts;
create policy company_facts_update on company_facts for update to authenticated
  using (app.can(tenant_id, 'brand.manage')) with check (app.can(tenant_id, 'brand.manage'));
drop policy if exists company_facts_delete on company_facts;
create policy company_facts_delete on company_facts for delete to authenticated using (app.can(tenant_id, 'brand.manage'));

-- Chamadas de modelo e designs: a conta lê; só o servidor grava (como posts).
drop policy if exists generation_runs_select on generation_runs;
create policy generation_runs_select on generation_runs for select to authenticated using (app.can(tenant_id, 'content.view'));
drop policy if exists post_designs_select on post_designs;
create policy post_designs_select on post_designs for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on company_facts, generation_runs, post_designs from anon, authenticated;
grant select, insert, update, delete on company_facts to authenticated;
grant select on generation_runs, post_designs to authenticated;
grant all on company_facts, generation_runs, post_designs to service_role;
