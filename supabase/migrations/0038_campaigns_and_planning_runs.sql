-- 0038_campaigns_and_planning_runs.sql: campanhas no coordenador de conteúdo (SPEC 018, BEZ-262).
--
-- 1. campaigns (da 0006, SPEC 001) ganha o que a campanha de uma conta precisa: tipo, oferta, público, CTA,
--    restrições, meta que a pessoa escreve, cadência, quem criou e quem confirmou. As colunas antigas (kpi,
--    phase, pillar, angle, formats_mix, budget_brl, context) ficam como estão. O status passa a ter lista.
--    Campanha só vale depois de confirmada (confirmed_at); rascunho não muda nenhuma sugestão.
--    Uma campanha ativa por conta (índice parcial). Se a base já tiver duas ativas na mesma conta, o índice
--    não é criado e a migration avisa: o servidor recusa a segunda de qualquer jeito.
-- 2. content_suggestions liga a campanha (FK composta com o tenant) e guarda a regra que escolheu o horário.
-- 3. planning_runs: uma linha por conta e dia, com chamadas ao modelo, custo e fallback. É o registro do custo
--    de planejamento e o que impede o job de gastar duas vezes no mesmo dia: `round_at` marca quando a rodada
--    diária do job passou por aquela conta (o "Trocar" manual também grava a linha, mas não marca a rodada).
--
-- Aditivo e reaplicável (o CI roda duas vezes). Nada é apagado.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Campanhas
-- ─────────────────────────────────────────────────────────────────────────────
alter table campaigns add column if not exists kind text
  check (kind is null or kind in ('divulgar', 'vender', 'captar', 'relacionar', 'marca'));
alter table campaigns add column if not exists offering text
  check (offering is null or length(trim(offering)) between 1 and 280);
alter table campaigns add column if not exists audience text
  check (audience is null or length(trim(audience)) between 1 and 280);
alter table campaigns add column if not exists cta text
  check (cta is null or cta in ('link_bio', 'whatsapp', 'dm'));
alter table campaigns add column if not exists restrictions text[] not null default '{}'
  check (cardinality(restrictions) <= 5 and length(array_to_string(restrictions, E'\n')) <= 750);
alter table campaigns add column if not exists target_label text
  check (target_label is null or length(trim(target_label)) between 1 and 80);
alter table campaigns add column if not exists target_value integer
  check (target_value is null or target_value >= 0);
alter table campaigns add column if not exists posts_per_week smallint
  check (posts_per_week is null or posts_per_week between 1 and 14);
alter table campaigns add column if not exists created_by uuid references users(id) on delete set null;
alter table campaigns add column if not exists confirmed_by uuid references users(id) on delete set null;
alter table campaigns add column if not exists confirmed_at timestamptz;

-- As campanhas antigas já estavam em vigor: a confirmação vale desde que foram criadas.
update campaigns set confirmed_at = created_at where confirmed_at is null and status in ('active', 'paused');

do $$
begin
  -- Lista de status (a coluna antiga era texto livre). `not valid`: só linha nova ou alterada é conferida.
  if not exists (select 1 from pg_constraint where conname = 'campaigns_status_check' and conrelid = 'public.campaigns'::regclass) then
    alter table campaigns add constraint campaigns_status_check
      check (status in ('draft', 'active', 'paused', 'ended', 'archived')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_objective_len' and conrelid = 'public.campaigns'::regclass) then
    alter table campaigns add constraint campaigns_objective_len
      check (objective is null or length(trim(objective)) between 1 and 280) not valid;
  end if;
  -- Fora de rascunho (e de arquivada sem nunca ter valido), a campanha tem quem e quando confirmou.
  if not exists (select 1 from pg_constraint where conname = 'campaigns_confirmed_when_live' and conrelid = 'public.campaigns'::regclass) then
    alter table campaigns add constraint campaigns_confirmed_when_live
      check (status in ('draft', 'archived') or confirmed_at is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_window_order' and conrelid = 'public.campaigns'::regclass) then
    alter table campaigns add constraint campaigns_window_order
      check (start_date is null or end_date is null or end_date >= start_date) not valid;
  end if;
end $$;

-- Para a FK composta de content_suggestions: a campanha só liga a sugestão da mesma conta.
create unique index if not exists campaigns_tenant_id_id_idx on campaigns (tenant_id, id);

do $$
begin
  if exists (select 1 from campaigns where status = 'active' group by tenant_id having count(*) > 1) then
    raise warning 'campaigns: há conta com mais de uma campanha ativa; o índice campaigns_one_active_idx não foi criado. Pause ou encerre as sobras e reaplique.';
  else
    create unique index if not exists campaigns_one_active_idx on campaigns (tenant_id) where status = 'active';
  end if;
end $$;

-- Escrever em campanha é de quem gere a marca (brand.manage), como o perfil e as regras. Ler continua com
-- qualquer membro (tenant_select, da 0012). As políticas de escrita antigas seguiam content.edit.
drop policy if exists tenant_insert on campaigns;
create policy tenant_insert on campaigns for insert to authenticated with check (app.can(tenant_id, 'brand.manage'));
drop policy if exists tenant_update on campaigns;
create policy tenant_update on campaigns for update to authenticated
  using (app.can(tenant_id, 'brand.manage')) with check (app.can(tenant_id, 'brand.manage'));
drop policy if exists tenant_delete on campaigns;
create policy tenant_delete on campaigns for delete to authenticated using (app.can(tenant_id, 'brand.manage'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sugestões ligadas à campanha
-- ─────────────────────────────────────────────────────────────────────────────
alter table content_suggestions add column if not exists campaign_id uuid;
alter table content_suggestions add column if not exists rule text
  check (rule is null or rule in ('date', 'photo', 'rotation', 'campaign'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_suggestions_campaign_fk' and conrelid = 'public.content_suggestions'::regclass) then
    alter table content_suggestions add constraint content_suggestions_campaign_fk
      foreign key (tenant_id, campaign_id) references campaigns (tenant_id, id) on delete set null (campaign_id);
  end if;
end $$;

create index if not exists content_suggestions_campaign_idx on content_suggestions (tenant_id, campaign_id) where campaign_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Planejamento por conta e dia
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists planning_runs (
  tenant_id   text not null references tenants(id) on delete cascade,
  ran_on      date not null,
  llm_calls   integer not null default 0 check (llm_calls >= 0),
  cost_usd    numeric(12, 6) not null default 0 check (cost_usd >= 0),
  suggested   integer not null default 0 check (suggested >= 0),
  fallback    boolean not null default false,
  status      text not null default 'done' check (status in ('done', 'failed')),
  error_code  text check (error_code is null or length(error_code) <= 80),
  round_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, ran_on)
);

alter table planning_runs add column if not exists round_at timestamptz;

drop trigger if exists planning_runs_touch on planning_runs;
create trigger planning_runs_touch before update on planning_runs
  for each row execute function app.touch_updated_at();

alter table planning_runs enable row level security;

drop policy if exists planning_runs_select on planning_runs;
create policy planning_runs_select on planning_runs for select to authenticated using (app.can(tenant_id, 'audit.view'));

revoke all on planning_runs from anon, authenticated;
grant select on planning_runs to authenticated;
grant all on planning_runs to service_role;
