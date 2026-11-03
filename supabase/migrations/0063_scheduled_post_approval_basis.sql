-- 0063_scheduled_post_approval_basis.sql: a base da aprovação do post agendado (SPEC 035, BEZ-543). Os fatos e a oferta da
-- campanha que o post afirmava quando foi aprovado: { at, facts: [{ id, text }], campaign: { id, offering } | null }. A
-- conferência antes de publicar (BEZ-275) compara com o estado de hoje. Null = aprovado antes desta coluna. Aditivo e reaplicável.

alter table scheduled_posts add column if not exists approval_basis jsonb;
