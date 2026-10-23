-- 0040_design_rules.sql: regra de marca proposta a partir de edições parecidas (SPEC 019, BEZ-270).
-- Quando a mesma mudança líquida (valor da v1 contra a versão em uso) se repete em 3 posts diferentes em
-- 30 dias, a Ekoai propõe uma regra do design da conta: canto do logo, esconder o logo, tirar o
-- subtítulo ou o selo, layout, cor do título e do subtítulo. Só quem gere a marca aceita; a regra vale
-- nos posts novos, nunca nos pendentes, e pode ser desligada. A explicação sai de template, nunca de
-- modelo, e a evidência leva contagem, datas e ids de revisão, nunca o texto do post.
--
-- Aprovado também marca o design (`post_designs.approved_at`): é o que separa a edição de um post
-- que seguiu da de um post recusado ou trocado por "outra direção", que não conta para a regra.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Nada é apagado; sem -- allow-destructive.

alter table post_designs add column if not exists approved_at timestamptz;

create table if not exists design_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null references tenants(id) on delete cascade,
  field        text not null check (field in ('layout', 'logoCorner', 'logoHidden', 'texts.sub', 'texts.kicker', 'colors.title', 'colors.sub')),
  scope        text not null check (scope in ('any', 'informativo', 'atmosfera')),
  rule_key     text not null check (length(rule_key) between 3 and 120),
  value        jsonb not null check (jsonb_typeof(value) in ('string', 'boolean')),
  status       text not null default 'proposed' check (status in ('proposed', 'active', 'off', 'dismissed')),
  evidence     jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 4096),
  explanation  text not null check (length(explanation) between 1 and 200),
  decided_by   uuid references users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, rule_key),
  -- layout e cor dependem do tipo do post (o fundo muda com a família)
  check (field not in ('layout', 'colors.title', 'colors.sub') or scope <> 'any')
);

-- Uma regra ativa por campo e escopo: aceitar outro canto de logo desliga o anterior.
create unique index if not exists design_rules_one_active_idx on design_rules (tenant_id, scope, field) where status = 'active';
create index if not exists design_rules_tenant_idx on design_rules (tenant_id, status, created_at desc);

drop trigger if exists design_rules_touch on design_rules;
create trigger design_rules_touch before update on design_rules
  for each row execute function app.touch_updated_at();

alter table design_rules enable row level security;

-- Quem vê o perfil lê as regras; só o servidor grava (como style_rules na tela de Aprendizado).
drop policy if exists design_rules_select on design_rules;
create policy design_rules_select on design_rules for select to authenticated using (app.can(tenant_id, 'profile.view'));

revoke all on design_rules from anon, authenticated;
grant select on design_rules to authenticated;
grant all on design_rules to service_role;
