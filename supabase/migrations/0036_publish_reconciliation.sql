-- 0036_publish_reconciliation.sql: publicação confiável (BEZ-258).
--
-- 1. Lease em `publishing`: cada tentativa leva um attempt_id e a hora de início. Só quem tem o
--    attempt_id atual grava o resultado; quem acordou tarde (depois que o reconciliador assumiu) não
--    sobrescreve nada. Post que passa do prazo em `publishing` é reconciliado, não republicado.
-- 2. meta_container_id: o container da Meta fica gravado antes do media_publish. Com ele, um resultado
--    incerto se resolve perguntando à Meta (PUBLISHED ou não) em vez de tentar de novo às cegas.
-- 3. publish_reconciliations: o que o reconciliador encontrou e decidiu, uma linha por decisão (auditoria).
-- 4. app.due_scheduled_posts: seleção de vencidos que já ignora contas pausadas e reparte o lote entre
--    as contas (uma conta não ocupa o lote todo), em vez de pegar 20 e filtrar depois.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Tem RLS e entra em TENANT_TABLES.

alter table scheduled_posts add column if not exists attempt_id uuid;
alter table scheduled_posts add column if not exists publishing_started_at timestamptz;
alter table scheduled_posts add column if not exists meta_container_id text
  check (meta_container_id is null or length(meta_container_id) <= 100);

-- O cron varre vencidos de todas as contas por horário; o parcial deixa isso barato.
create index if not exists scheduled_due_global_idx on scheduled_posts (scheduled_for, id) where status = 'scheduled';
-- E procura quem ficou preso em publishing além do prazo.
create index if not exists scheduled_publishing_idx on scheduled_posts (publishing_started_at) where status = 'publishing';

create table if not exists publish_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null references tenants(id) on delete cascade,
  scheduled_post_id  uuid not null references scheduled_posts(id) on delete cascade,
  stale_attempt_id   uuid,
  channel            text not null,
  container_id       text check (container_id is null or length(container_id) <= 100),
  -- o que a rede disse: published | not_published | in_progress | unknown | no_container | unverifiable
  found              text not null check (found in ('published', 'not_published', 'in_progress', 'unknown', 'no_container', 'unverifiable')),
  -- o que o reconciliador fez: marked_published (já estava no ar) | published_now (container pronto, publicou agora) |
  -- requeued (nada no ar, volta à fila) | failed_for_review (incerto, a pessoa confere) | waiting (próximo ciclo)
  action             text not null check (action in ('marked_published', 'requeued', 'failed_for_review', 'published_now', 'waiting')),
  detail             text check (detail is null or length(detail) <= 500),
  created_at         timestamptz not null default now()
);

create index if not exists publish_reconciliations_post_idx on publish_reconciliations (scheduled_post_id, created_at desc);
create index if not exists publish_reconciliations_tenant_idx on publish_reconciliations (tenant_id, created_at desc);

alter table publish_reconciliations enable row level security;

-- A conta lê o próprio histórico; só o servidor grava.
drop policy if exists publish_reconciliations_select on publish_reconciliations;
create policy publish_reconciliations_select on publish_reconciliations for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on publish_reconciliations from anon, authenticated;
grant select on publish_reconciliations to authenticated;
grant all on publish_reconciliations to service_role;

-- Vencidos prontos para sair: status scheduled, horário passado e conta que não está pausada. A numeração
-- por conta (rn) faz o lote sair em rodadas: o 1º de cada conta, depois o 2º de cada uma, e assim por
-- diante, sempre do mais antigo ao mais novo. Uma conta com 500 vencidos não tira a vez das outras; com
-- uma conta só, o lote inteiro é dela.
create or replace function app.due_scheduled_posts(p_now timestamptz, p_limit integer)
returns table (id uuid, tenant_id text)
language sql stable set search_path = ''
as $$
  select r.id, r.tenant_id
  from (
    select sp.id, sp.tenant_id, sp.scheduled_for,
           row_number() over (partition by sp.tenant_id order by sp.scheduled_for, sp.id) as rn
    from public.scheduled_posts sp
    where sp.status = 'scheduled'
      and sp.scheduled_for <= p_now
      and not exists (select 1 from public.publishing_controls pc where pc.tenant_id = sp.tenant_id and pc.paused)
  ) r
  order by r.rn, r.scheduled_for, r.id
  limit greatest(p_limit, 0);
$$;

revoke execute on function app.due_scheduled_posts(timestamptz, integer) from public, anon, authenticated;
grant execute on function app.due_scheduled_posts(timestamptz, integer) to service_role;
