-- 0054_linkedin_pages.sql: publicar no LinkedIn como página (BEZ-455). Aditivo e reaplicável.
-- `social_accounts.pages`: as páginas que a pessoa administra, lidas na conexão ([{urn, name}]).
-- `social_accounts.publish_as`: a página escolhida como autora dos posts (urn:li:organization:<id>); null é o perfil pessoal.

alter table social_accounts add column if not exists pages jsonb not null default '[]'::jsonb
  check (jsonb_typeof(pages) = 'array' and pg_column_size(pages) <= 8192);

alter table social_accounts add column if not exists publish_as text
  check (publish_as is null or publish_as ~ '^urn:li:organization:[0-9]{1,20}$');
