-- 0032_brief_photo.sql: foto do banco de imagens no pedido de post (SPEC 017 decisão 7, BEZ-237).
-- O pedido guarda a foto (asset_id) e como usá-la (photo_usage): como está, de fundo, no layout da
-- marca ou só como inspiração. A FK composta impede usar a foto de outra conta; apagar a foto solta o
-- pedido (a geração recusa com mensagem clara).
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table briefs add column if not exists asset_id uuid;
alter table briefs add column if not exists photo_usage text
  check (photo_usage is null or photo_usage in ('as_is', 'background', 'layout', 'inspiration'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'briefs_media_asset_fk') then
    alter table briefs add constraint briefs_media_asset_fk
      foreign key (tenant_id, asset_id) references media_assets (tenant_id, id) on delete set null (asset_id);
  end if;
end $$;
