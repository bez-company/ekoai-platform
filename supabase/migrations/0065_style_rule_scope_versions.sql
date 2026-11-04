-- 0065_style_rule_scope_versions.sql: regras de texto e tom com escopo e versão (SPEC 037, BEZ-547).
--
-- `style_rules.campaign_id`: nulo = vale para a marca toda; preenchido = só nos posts daquela campanha, enquanto ela estiver
-- em vigor. Apagar a campanha apaga as regras dela (elas não fazem sentido sozinhas). `style_rule_versions`: a foto de
-- cada mudança (criar, editar, ligar, desligar, restaurar), para ver e voltar. As regras que já existem ganham a versão 1.
--
-- Aditivo e reaplicável (o CI roda duas vezes). A tabela nova tem RLS e entra em TENANT_TABLES.

alter table style_rules add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
create index if not exists style_rules_campaign_idx on style_rules (tenant_id, campaign_id) where campaign_id is not null;

create table if not exists style_rule_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references tenants(id) on delete cascade,
  rule_id     uuid not null references style_rules(id) on delete cascade,
  version     integer not null check (version >= 1),
  rule        text not null check (length(trim(rule)) between 1 and 300),
  aspect      text,
  channel     text,
  campaign_id uuid,
  active      boolean not null,
  change      text not null check (change in ('created', 'edited', 'on', 'off', 'restored')),
  changed_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (rule_id, version)
);
create index if not exists style_rule_versions_rule_idx on style_rule_versions (rule_id, version desc);

-- As regras de hoje entram com a versão 1, o texto atual e a data em que foram criadas.
insert into style_rule_versions (tenant_id, rule_id, version, rule, aspect, channel, campaign_id, active, change, created_at)
select r.tenant_id, r.id, 1, left(r.rule, 300), r.aspect, r.channel, r.campaign_id, r.active, 'created', r.created_at
from style_rules r
join tenants t on t.id = r.tenant_id
where length(trim(r.rule)) > 0
  and not exists (select 1 from style_rule_versions v where v.rule_id = r.id);

alter table style_rule_versions enable row level security;

drop policy if exists style_rule_versions_select on style_rule_versions;
create policy style_rule_versions_select on style_rule_versions for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on style_rule_versions from anon, authenticated;
grant select on style_rule_versions to authenticated;
grant all on style_rule_versions to service_role;
