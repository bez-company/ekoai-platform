-- 0047_brief_slide_count.sql: a quantidade de lâminas que a pessoa escolheu no carrossel (SPEC 025, BEZ-373). Nula = a
-- Ekoai decide (2 a 10, o teto do Instagram). Com valor, o redator escreve exatamente essa quantidade. Só faz sentido com
-- format = 'carousel'; o parser da rota recusa o resto. Aditivo e reaplicável (o CI roda duas vezes).

alter table briefs add column if not exists slide_count smallint
  check (slide_count is null or slide_count between 2 and 10);
