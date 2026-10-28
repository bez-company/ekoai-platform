-- 0051_time_plan_unlimited_seats.sql: o plano Time (`inicial`) deixa de limitar a equipe em 5 pessoas (BEZ-431). Na fase de
-- teste o Time convida quantas pessoas quiser; a taxa de R$ 10 por usuário adicional só existe quando a cobrança começar.
-- 1000 é o teto da coluna (check 1 a 1000) e vale como "sem limite": a tela não mostra o número. Aditivo e reaplicável.
update plans set max_seats = 1000 where id = 'inicial' and max_seats < 1000;
