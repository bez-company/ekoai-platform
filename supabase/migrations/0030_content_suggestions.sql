-- 0030_content_suggestions.sql: sugestões do coordenador de conteúdo (SPEC 017 decisão 8, BEZ-239).
--
-- Um job diário por conta propõe um post por horário livre dos próximos 7 dias: o objetivo, a foto do
-- banco (quando houver), a ideia e o motivo em uma frase. A pessoa decide: Criar este post (status
-- created, com o pedido gerado em brief_id), Trocar (replaced, e entra outra para o mesmo horário) ou
-- Pular (skipped). Nada é gerado sem a pessoa pedir. Só o servidor grava.
--
-- Aditivo e reaplicável (o CI roda duas vezes). A tabela tem RLS e entra em TENANT_TABLES.

create table if not exists content_suggestions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null references tenants(id) on delete cascade,
  channel      text not null default 'instagram' check (channel in ('instagram')),
  slot_at      timestamptz not null,
  goal         text not null check (goal in ('ensinar', 'produto', 'bastidores', 'novidade', 'promocao', 'prova_social', 'data_comemorativa', 'conversa')),
  asset_id     uuid,
  date_key     text check (date_key is null or date_key ~ '^[a-z0-9-]{3,40}$'),
  idea         text not null check (length(trim(idea)) between 1 and 160),
  reason       text not null check (length(trim(reason)) between 1 and 200),
  status       text not null default 'suggested' check (status in ('suggested', 'created', 'skipped', 'replaced')),
  brief_id     uuid references briefs(id) on delete set null,
  decided_by   uuid references users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, asset_id) references media_assets (tenant_id, id) on delete set null (asset_id)
);

-- Um horário tem no máximo uma sugestão aberta; duas rodadas ao mesmo tempo não duplicam.
create unique index if not exists content_suggestions_open_slot_idx
  on content_suggestions (tenant_id, channel, slot_at) where status = 'suggested';
create index if not exists content_suggestions_tenant_idx on content_suggestions (tenant_id, slot_at desc);

alter table content_suggestions enable row level security;

drop policy if exists content_suggestions_select on content_suggestions;
create policy content_suggestions_select on content_suggestions for select to authenticated using (app.can(tenant_id, 'content.view'));

revoke all on content_suggestions from anon, authenticated;
grant select on content_suggestions to authenticated;
grant all on content_suggestions to service_role;
