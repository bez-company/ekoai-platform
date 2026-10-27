-- 0045_posts_removed.sql: post publicado que saiu da lista (BEZ-360). A Ekoai não apaga post no Instagram (a API
-- da Meta não permite); quando a pessoa o apaga lá, a leitura de métricas vê que o post não existe mais e marca
-- `removed_at`, e Publicados deixa de mostrá-lo. A pessoa também pode tirar um post da lista pelo detalhe.
-- A linha e o histórico ficam (aprendizado e auditoria); só a lista e as médias deixam de contá-lo.
-- Aditivo e reaplicável (o CI roda duas vezes): a coluna só é criada se não existir.

alter table posts add column if not exists removed_at timestamptz;
