// tenant-db.ts: acesso ao banco já escopado por tenant (ADR 0005). Toda leitura, alteração e
// remoção sai com `tenant_id = <tenant>`, e toda escrita nova sai carimbada com ele. O tenant
// vem da sessão (session.ts), nunca do corpo da requisição.
//
// O usuário do banco ainda ignora RLS (papel de serviço), então é ESTE módulo que isola até o
// acesso por usuário (`withUser`, ADR 0007) entrar. Um teste (tests/tenant-scope.test.js) proíbe `db()` cru fora de
// uma lista curta de usos de sistema.

import type { DbClient } from '@ekoai/db';
import { db } from './db';
import { isTenantId } from './tenant';

type Row = Record<string, unknown>;

function stamp<T extends Row | Row[]>(rows: T, tenantId: string): T {
  const one = (r: Row) => ({ ...r, tenant_id: tenantId });
  return (Array.isArray(rows) ? rows.map(one) : one(rows)) as unknown as T;
}

// Mudar o dono de uma linha não é operação de usuário.
function withoutTenant(values: Row): Row {
  const { tenant_id: _ignored, ...rest } = values;
  return rest;
}

export function tenantDb(tenantId: string, client?: DbClient) {
  if (!isTenantId(tenantId)) throw new Error(`tenant inválido: ${String(tenantId)}`);
  const from = (table: string) => (client ?? db()).from(table);
  return {
    tenantId,
    select: (
      table: string,
      columns = '*',
      options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
    ) => from(table).select(columns, options).eq('tenant_id', tenantId),
    insert: (table: string, rows: Row | Row[]) => from(table).insert(stamp(rows, tenantId)),
    upsert: (table: string, rows: Row | Row[], options?: { onConflict?: string }) =>
      from(table).upsert(stamp(rows, tenantId), options),
    update: (table: string, values: Row) => from(table).update(withoutTenant(values)).eq('tenant_id', tenantId),
    delete: (table: string) => from(table).delete().eq('tenant_id', tenantId),
  };
}

export type TenantDb = ReturnType<typeof tenantDb>;
