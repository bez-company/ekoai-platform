// export.ts: tudo que a plataforma guarda do tenant, em um JSON (LGPD, portabilidade).
// Só lê, só do tenant da sessão. Os tokens das redes (social_account_secrets) não têm tenant_id e
// não estão em TENANT_TABLES, então nunca saem aqui; o hash do token de convite é cortado abaixo.

// Colunas que nunca entram no arquivo, por tabela.
const REDACTED: Record<string, readonly string[]> = {
  invitations: ['token_hash'],
};

import type { TenantDb } from './tenant-db';
import { TENANT_TABLES } from './tenant-tables';

const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 50_000;

function redact(table: string, row: unknown): unknown {
  const drop = REDACTED[table];
  if (!drop || typeof row !== 'object' || row === null) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key)));
}

async function readAll(t: TenantDb, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE) {
    const { data, error } = await t.select(table).range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao exportar ${table}: ${error.message}`);
    rows.push(...(data || []).map((row) => redact(table, row)));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export async function exportTenant(t: TenantDb): Promise<{
  tenant: string;
  exported_at: string;
  tables: Record<string, unknown[]>;
}> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TENANT_TABLES) tables[name] = await readAll(t, name);
  return { tenant: t.tenantId, exported_at: new Date().toISOString(), tables };
}
