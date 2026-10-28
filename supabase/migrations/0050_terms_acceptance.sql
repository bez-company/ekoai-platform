-- 0050_terms_acceptance.sql: aceite dos Termos de uso e da Política de privacidade (BEZ-32). Guarda a versão aceita e
-- quando, na pessoa, para provar o aceite e pedir um novo quando os textos mudarem. Aditivo e reaplicável (o CI
-- roda duas vezes): as colunas só são criadas se não existirem; quem já tem conta fica sem aceite registrado.

alter table users add column if not exists terms_version text
  check (terms_version is null or terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
alter table users add column if not exists terms_accepted_at timestamptz;
