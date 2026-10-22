-- 0024_queue_without_slot.sql: post aprovado sem horário livre na agenda fica na fila (status
-- 'queued', scheduled_for vazio) e entra no primeiro horário que a conta criar. O cron só pega
-- 'scheduled' com scheduled_for vencido, então a fila nunca publica sozinha.
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table scheduled_posts alter column scheduled_for drop not null;
