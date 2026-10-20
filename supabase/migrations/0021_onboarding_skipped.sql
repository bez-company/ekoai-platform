-- 0021_onboarding_skipped.sql: passos opcionais do checklist de Início que a conta pulou
-- (SPEC 011 R6). Hoje só o "convidar a equipe" pode ser pulado; a lista fecha em `team`.
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table tenants add column if not exists onboarding_skipped text[] not null default '{}'
  check (onboarding_skipped <@ array['team']::text[]);
