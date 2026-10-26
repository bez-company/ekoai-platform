-- 0043_observation_settings.sql: quais observações do público entram no planejamento (SPEC 022, BEZ-206).
-- A observação nasce dos números da conta (Aprendizado › O público) e é calculada na hora. O que fica guardado
-- é só a escolha de quem gere a marca: usar ou não a observação como dica no planejamento de ideias. Nunca vira
-- regra da marca. Desligada por padrão: sem linha, a observação não entra.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Nada é apagado; sem -- allow-destructive.

create table if not exists observation_settings (
  tenant_id  text not null references tenants(id) on delete cascade,
  key        text not null check (key in ('content', 'audience')),
  enabled    boolean not null default false,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

alter table observation_settings enable row level security;

-- Quem vê o perfil lê a escolha; só o servidor grava, depois de checar brand.manage (como design_rules).
drop policy if exists observation_settings_select on observation_settings;
create policy observation_settings_select on observation_settings for select to authenticated using (app.can(tenant_id, 'profile.view'));

revoke all on observation_settings from anon, authenticated;
grant select on observation_settings to authenticated;
grant all on observation_settings to service_role;
