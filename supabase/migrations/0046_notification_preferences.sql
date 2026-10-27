-- 0046_notification_preferences.sql: o que cada pessoa quer receber, por categoria de aviso (BEZ-366). Vale para todas
-- as contas dela (como o resto do perfil), por isso não tem tenant_id: a chave é pessoa + categoria. `in_app` liga o
-- aviso no sino; `email` guarda a escolha do e-mail (o envio depende do provedor de e-mail, ainda não ligado). Sem
-- linha, os dois valem como ligados. Aditivo e reaplicável (o CI roda duas vezes).

create table if not exists notification_preferences (
  user_id    uuid not null references users(id) on delete cascade,
  category   text not null check (category in ('publication', 'approval', 'planning', 'connection', 'account')),
  in_app     boolean not null default true,
  email      boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

alter table notification_preferences enable row level security;
revoke all on notification_preferences from anon, authenticated;
grant all on notification_preferences to service_role;
