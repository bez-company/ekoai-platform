-- 0028_media_assets.sql: banco de imagens da empresa (SPEC 017 decisão 9, BEZ-198).
--
-- 1. media_assets: uma linha por foto que a empresa subiu. O arquivo mora no bucket privado, em
--    `tenants/<conta>/media/<id>.<jpg|png>`, e só sai por rota com sessão (como o logo, ADR 0014);
--    nunca por /api/media, que é pública. Para publicar, a plataforma copia a foto para
--    `images/<uuid>` (ADR 0009) e o post guarda essa URL.
--    A descrição e as etiquetas vêm do modelo de visão (editáveis). `has_people` também vem da
--    visão; foto com pessoas só entra em post com `people_consent` (autorização de uso de imagem).
--    `used_at` e `used_post_id` marcam a última vez que a foto saiu num post publicado.
-- 2. scheduled_posts.media_asset_id: o post agendado que usa uma foto do banco. Ao publicar, a foto
--    é marcada como usada. A FK composta impede apontar para a foto de outra conta.
--
-- Aditivo e reaplicável (o CI roda duas vezes). A tabela tem RLS e entra em TENANT_TABLES.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fotos
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists media_assets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references tenants(id) on delete cascade,
  storage_path    text not null check (
    length(storage_path) <= 300 and storage_path like 'tenants/' || tenant_id || '/media/%' and storage_path !~ '\.\.'
  ),
  content_type    text not null check (content_type in ('image/jpeg', 'image/png')),
  byte_size       integer not null check (byte_size between 1 and 10485760),
  width           integer not null check (width between 1 and 8192),
  height          integer not null check (height between 1 and 8192),
  original_name   text check (original_name is null or length(original_name) <= 200),
  description     text check (description is null or length(description) <= 400),
  tags            text[] not null default '{}' check (
    cardinality(tags) <= 7 and tags <@ array['produto', 'equipe', 'bastidor', 'espaco', 'evento', 'cliente', 'outro']::text[]
  ),
  has_people      boolean,
  people_consent  boolean not null default false,
  described_at    timestamptz,
  used_at         timestamptz,
  used_post_id    uuid references posts(id) on delete set null,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);

create index if not exists media_assets_tenant_idx on media_assets (tenant_id, created_at desc);
create index if not exists media_assets_unused_idx on media_assets (tenant_id, used_at);

drop trigger if exists media_assets_touch on media_assets;
create trigger media_assets_touch before update on media_assets
  for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O post agendado que usa a foto
-- ─────────────────────────────────────────────────────────────────────────────
alter table scheduled_posts add column if not exists media_asset_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_media_asset_fk') then
    alter table scheduled_posts add constraint scheduled_posts_media_asset_fk
      foreign key (tenant_id, media_asset_id) references media_assets (tenant_id, id) on delete set null (media_asset_id);
  end if;
end $$;

create index if not exists scheduled_posts_media_asset_idx on scheduled_posts (media_asset_id) where media_asset_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS e grants
-- ─────────────────────────────────────────────────────────────────────────────
alter table media_assets enable row level security;

-- Quem vê o conteúdo vê as fotos; quem cria post sobe; quem edita conteúdo altera e apaga.
drop policy if exists media_assets_select on media_assets;
create policy media_assets_select on media_assets for select to authenticated using (app.can(tenant_id, 'content.view'));
drop policy if exists media_assets_insert on media_assets;
create policy media_assets_insert on media_assets for insert to authenticated with check (app.can(tenant_id, 'content.create'));
drop policy if exists media_assets_update on media_assets;
create policy media_assets_update on media_assets for update to authenticated
  using (app.can(tenant_id, 'content.edit')) with check (app.can(tenant_id, 'content.edit'));
drop policy if exists media_assets_delete on media_assets;
create policy media_assets_delete on media_assets for delete to authenticated using (app.can(tenant_id, 'content.edit'));

revoke all on media_assets from anon, authenticated;
grant select, insert, update, delete on media_assets to authenticated;
grant all on media_assets to service_role;
