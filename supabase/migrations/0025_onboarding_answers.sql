-- 0025_onboarding_answers.sql: as 3 perguntas rápidas do onboarding (SPEC 017, decisão 11; BEZ-234).
--
-- Uma linha por conta, gravada quando a pessoa responde ou pula a tela. Toda resposta pode ficar em
-- branco (pular); a linha existir já diz que a tela não volta. `posts_per_week` cria os horários
-- padrão da agenda (lib/onboarding.ts, defaultSlots), só quando a conta ainda não tem nenhum.
-- As respostas também vão para o PostHog (evento da conta, sem dado da pessoa) e para o coordenador.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Tem RLS e entra em TENANT_TABLES.

create table if not exists onboarding_answers (
  tenant_id       text primary key references tenants(id) on delete cascade,
  source          text check (source is null or source in ('instagram', 'indicacao', 'google', 'evento', 'outro')),
  goal            text check (goal is null or goal in ('vender_mais', 'perfil_ativo', 'ganhar_tempo', 'crescer_seguidores')),
  posts_per_week  smallint check (posts_per_week is null or posts_per_week in (2, 3, 5)),
  answered_by     uuid references users(id) on delete set null,
  answered_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists onboarding_answers_touch on onboarding_answers;
create trigger onboarding_answers_touch before update on onboarding_answers
  for each row execute function app.touch_updated_at();

alter table onboarding_answers enable row level security;

-- A conta lê; quem cuida da publicação responde (a última pergunta cria os horários).
drop policy if exists onboarding_answers_select on onboarding_answers;
create policy onboarding_answers_select on onboarding_answers for select to authenticated using (app.can(tenant_id, 'content.view'));
drop policy if exists onboarding_answers_insert on onboarding_answers;
create policy onboarding_answers_insert on onboarding_answers for insert to authenticated with check (app.can(tenant_id, 'publishing.manage'));
drop policy if exists onboarding_answers_update on onboarding_answers;
create policy onboarding_answers_update on onboarding_answers for update to authenticated
  using (app.can(tenant_id, 'publishing.manage')) with check (app.can(tenant_id, 'publishing.manage'));

revoke all on onboarding_answers from anon, authenticated;
grant select, insert, update on onboarding_answers to authenticated;
grant all on onboarding_answers to service_role;
