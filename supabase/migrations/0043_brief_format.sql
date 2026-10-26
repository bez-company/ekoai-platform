-- 0043_brief_format.sql: o tipo do post pelo número de imagens (SPEC 023, ADR 0025). A pessoa escolhe ao criar o
-- pedido: `single` (uma imagem, o que existia) ou `carousel` (de 2 a 6 lâminas dentro do mesmo design). Pedido antigo
-- fica como `single`. As lâminas moram no jsonb de post_designs.design, então esta é a única mudança de banco.
-- Aditivo e reaplicável (o CI roda duas vezes): a coluna só é criada se não existir.

alter table briefs add column if not exists format text not null default 'single'
  check (format in ('single', 'carousel'));
