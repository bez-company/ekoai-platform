-- 0066_business_events.sql: resultados comerciais com origem (SPEC 038, BEZ-551).
--
-- A pessoa registra à mão um contato, orçamento, pedido ou venda e diz de onde vem a certeza: pelo link do post com o código
-- da Ekoai (observed), o cliente disse (declared) ou não sei (unknown). Ligado à campanha e, se der, ao post. Sem dado pessoal
-- do cliente: a observação tem até 200 caracteres. Contato não tem valor. Só o servidor grava.
--
-- Aditivo e reaplicável (o CI roda duas vezes). A tabela tem RLS e entra em TENANT_TABLES.

create table if not exists business_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references tenants(id) on delete cascade,
  kind        text not null check (kind in ('contact', 'quote', 'order', 'sale')),
  occurred_on date not null,
  value_brl   numeric(12, 2) check (value_brl is null or (value_brl >= 0 and value_brl <= 10000000)),
  origin      text not null check (origin in ('observed', 'declared', 'unknown')),
  campaign_id uuid references campaigns(id) on delete set null,
  post_id     uuid references posts(id) on delete set null,
  note        text check (note is null or length(note) <= 200),
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (kind <> 'contact' or value_brl is null)
);
create index if not exists business_events_campaign_idx on business_events (tenant_id, campaign_id, occurred_on desc);
create index if not exists business_events_post_idx on business_events (tenant_id, post_id) where post_id is not null;

alter table business_events enable row level security;

drop policy if exists business_events_select on business_events;
create policy business_events_select on business_events for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on business_events from anon, authenticated;
grant select on business_events to authenticated;
grant all on business_events to service_role;
