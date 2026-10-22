-- 0031_stale_approvals.sql: posts esquecidos em Aprovar (SPEC 017, decisão 12; BEZ-242).
--
-- Post esperando há mais de 3 dias gera um aviso; há mais de 14, a Ekoai pergunta se arquiva. Cada
-- aviso sai uma vez por post: as duas datas marcam o que já foi avisado. Arquivar tira o post de Aprovar
-- sem rejeitar (não vira sinal de aprendizado) e pode ser desfeito (archived_at volta a nulo).
--
-- Aditivo e reaplicável (o CI roda duas vezes).

alter table pending_approvals add column if not exists stale_notified_at timestamptz;
alter table pending_approvals add column if not exists archive_asked_at timestamptz;
alter table pending_approvals add column if not exists archived_at timestamptz;

-- O cron varre só o que ainda pode gerar aviso: não arquivado e sem a pergunta de arquivar.
create index if not exists pending_approvals_stale_idx on pending_approvals (saved_at)
  where archived_at is null and archive_asked_at is null;
