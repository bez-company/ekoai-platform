-- 0049_company_reach.sql: onde estão os clientes da empresa (BEZ-373). A Ekoai escreve a legenda e escolhe as hashtags pelo
-- alcance: `local` fala da cidade ou região, `national` do Brasil todo, `international` do Brasil e do exterior. Nulo é conta
-- que ainda não respondeu: o texto não prende o post à cidade. Aditivo e reaplicável (o CI roda duas vezes).

alter table company_profiles add column if not exists reach text
  check (reach is null or reach in ('local', 'national', 'international'));
