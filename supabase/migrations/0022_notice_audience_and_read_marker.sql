-- 0022_notice_audience_and_read_marker.sql: avisos por público e o "lido até quando" de cada
-- pessoa (SPEC 011 R6.3).
--
-- 1. notifications.audience: quem recebe o aviso. `admin` (quem administra a conta), `team`
--    (administrador e criador) ou `all` (todos, inclusive o leitor). O padrão é `admin`: aviso que
--    ninguém classificou não vaza para quem não pode agir sobre ele. A policy de leitura passa a
--    respeitar o público, então o leitor só lê o que é para todos mesmo falando direto com o banco.
-- 2. tenant_members.notices_seen_at: até quando esta pessoa, nesta conta, já viu os avisos. O
--    contador de não lidos é o que veio depois disso e é do público dela. Uma coluna por pessoa e
--    conta, sem uma linha de leitura por aviso.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table notifications add column if not exists audience text not null default 'admin'
  check (audience in ('admin', 'team', 'all'));

alter table tenant_members add column if not exists notices_seen_at timestamptz not null default now();

drop policy if exists tenant_select on notifications;
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated using (
  (audience = 'all' and app.is_tenant_member(tenant_id))
  or (audience = 'team' and app.can(tenant_id, 'content.create'))
  or (audience = 'admin' and app.can(tenant_id, 'team.manage'))
);
