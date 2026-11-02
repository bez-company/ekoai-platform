-- 0062_brand_logo_jpeg.sql: a logo da empresa também pode ser JPG (BEZ-526). Aditivo e reaplicável: troca a lista de tipos aceitos.

alter table brand_assets drop constraint if exists brand_assets_content_type_check;
alter table brand_assets add constraint brand_assets_content_type_check
  check (content_type in ('image/png', 'image/svg+xml', 'image/jpeg'));
