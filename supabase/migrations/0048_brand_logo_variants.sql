-- 0048_brand_logo_variants.sql: variações da logo (SPEC 026, BEZ-369). Além da principal, a conta pode enviar uma versão para fundo escuro,
-- uma para fundo claro e uma só com o símbolo; o motor de design escolhe pela cor do fundo do post. `variant` vale `main` para o que já
-- existe (a logo apontada por company_profiles.logo_asset_id). Só pode haver uma variação de cada tipo por conta; a principal continua
-- sendo uma só pelo ponteiro do perfil (a troca insere a nova antes de apagar a antiga, por isso o índice não vale para `main`).
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table brand_assets add column if not exists variant text not null default 'main'
  check (variant in ('main', 'dark', 'light', 'symbol'));

create unique index if not exists brand_assets_variant_uq on brand_assets (tenant_id, variant) where variant <> 'main';
