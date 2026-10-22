-- 0034_data_deletion_requests.sql: pedidos de exclusão de dados que a Meta manda (SPEC 011 R5.4, BEZ-215).
--
-- Quando a pessoa remove o app no Instagram e pede a exclusão dos dados, a Meta chama o callback com um
-- signed_request. A plataforma revoga a conexão (o gatilho da 0018 apaga o token) e responde com um código
-- de confirmação e a URL pública de status, que a Meta mostra para a pessoa. Esta tabela guarda só o
-- necessário para essa página: nenhum dado da pessoa, e o id do Instagram vai como hash.
-- Sem tenant_id de propósito: o pedido vem da Meta, antes de saber a conta, e pode tocar mais de uma.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

create table if not exists data_deletion_requests (
  id                  uuid primary key default gen_random_uuid(),
  confirmation_code   text not null unique check (confirmation_code ~ '^[A-Za-z0-9_-]{16,64}$'),
  channel             text not null check (channel in ('instagram')),
  external_user_hash  text not null check (external_user_hash ~ '^[0-9a-f]{64}$'),
  accounts_revoked    integer not null default 0 check (accounts_revoked >= 0),
  requested_at        timestamptz not null default now()
);

-- Só o servidor lê e grava (a página de status passa pelo servidor).
alter table data_deletion_requests enable row level security;
revoke all on data_deletion_requests from anon, authenticated;
grant all on data_deletion_requests to service_role;
