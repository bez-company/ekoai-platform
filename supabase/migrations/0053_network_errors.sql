-- 0053_network_errors.sql: a rede que falhou num pedido de várias redes (SPEC 028, BEZ-437). Aditivo e reaplicável.
-- `briefs.network_errors`: rede -> motivo da última falha ({"linkedin": "modelo fora do ar"}). Some quando a rede é gerada.
-- Serve à tela "Gerando": a rede que falhou mostra o motivo e "Tentar de novo" só nela, sem refazer as outras.

alter table briefs add column if not exists network_errors jsonb not null default '{}'::jsonb
  check (jsonb_typeof(network_errors) = 'object' and pg_column_size(network_errors) <= 2048);
