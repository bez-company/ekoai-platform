-- 0055_studio_effort_style.sql: esforço, estilo e qualidade da imagem do post (SPEC 030, BEZ-464). Aditivo e reaplicável.
-- `briefs.effort`: o nível de esforço dos agentes. Pedido antigo é Instantâneo (o motor de hoje).
-- `briefs.style`: o estilo da vitrine (id de um estilo) ou uma das formas automáticas: auto, auto-minimalista, auto-imagem.
--   O parser da plataforma confere o id; o banco só garante o formato, para estilo novo não exigir migration.
-- `briefs.image_quality`: padrao ou alta; null quando o post não usa imagem de IA.

alter table briefs add column if not exists effort text not null default 'instantaneo'
  check (effort in ('instantaneo', 'padrao', 'refinado', 'autoral', 'pro'));

alter table briefs add column if not exists style text not null default 'auto'
  check (style ~ '^[a-z][a-z0-9-]{1,48}$');

alter table briefs add column if not exists image_quality text
  check (image_quality is null or image_quality in ('padrao', 'alta'));
