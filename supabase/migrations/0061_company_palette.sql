-- 0061_company_palette.sql: as cores de apoio da marca, além da principal e da de destaque (SPEC 033, BEZ-524). Aditivo e reaplicável.
-- `color_palette`: até 6 cores #RRGGBB, sem repetir. O formato de cada cor é conferido na entrada (company-profile-model.ts);
-- o banco garante que é uma lista curta.

alter table company_profiles add column if not exists color_palette text[] not null default '{}'
  check (cardinality(color_palette) <= 6);
