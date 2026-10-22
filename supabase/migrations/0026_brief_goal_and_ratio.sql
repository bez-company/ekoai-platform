-- 0026_brief_goal_and_ratio.sql: objetivo e formato do pedido de post (SPEC 017, decisões 5 e 6).
-- O objetivo é o que a pessoa quer (ensinar, mostrar o produto, bastidores...); a montagem
-- (post_kind) passa a ser decisão interna. O formato vai do pedido ao render (4:5 ou 1:1).
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table briefs add column if not exists goal text
  check (goal is null or goal in ('ensinar', 'produto', 'bastidores', 'novidade', 'promocao', 'prova_social', 'data_comemorativa', 'conversa', 'auto'));
alter table briefs add column if not exists ratio text not null default '4:5'
  check (ratio in ('1:1', '4:5'));
