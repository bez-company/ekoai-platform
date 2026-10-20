-- 0020_user_names_and_resend_limit.sql: nome da pessoa e limite de vagas ao reenviar convite
-- (SPEC 011 R4).
--
-- 1. users.name: a tela de equipe e o convite mostram "Ana Ribeiro", não só o e-mail. O nome vem
--    do cadastro (o Identity Platform o devolve no ID token) e fica em `users`, que é nossa.
--    Opcional: quem foi criado por convite antes de entrar ainda não tem nome.
-- 2. Reenviar um convite vencido o põe de volta como pendente e, por isso, ocupa vaga de novo. O
--    gatilho da 0018 só olhava a inserção; este olha a reativação, com a mesma regra de vagas.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table users add column if not exists name text check (name is null or length(trim(name)) between 1 and 80);

drop trigger if exists invitations_seat_limit_resend on invitations;
create trigger invitations_seat_limit_resend before update of expires_at on invitations
  for each row
  when (new.expires_at > old.expires_at and old.expires_at <= now() and new.accepted_at is null and new.cancelled_at is null)
  execute function app.check_seat_limit();
