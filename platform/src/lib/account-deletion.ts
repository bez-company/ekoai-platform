// account-deletion.ts: excluir uma conta de verdade (SPEC 011 R8). Uso de sistema: atravessa todas
// as tabelas da conta de propósito, por isso usa o acesso cru ao banco (está na lista de tests/tenant-scope).
//
// Numa transação só: grava a auditoria (que sobrevive à conta: sem FK, só ids e papéis), apaga as
// tabelas da conta na ordem das chaves estrangeiras, solta a última conta das pessoas e apaga a
// conta (as membresias e os tokens cifrados das redes saem em cascata). Depois de confirmar, apaga
// os arquivos do bucket (`tenants/<conta>/`). A pessoa em si NÃO é apagada: o login dela pode valer
// em outra conta.

import { db } from './db';
import { TENANT_TABLES } from './tenant-tables';
import { recordAudit } from './audit';
import { deletionOrder } from './account-deletion-model';
import { defaultStore, type BlobStore } from './brand-logo';
import { log } from './log';

// A auditoria é a única tabela da conta que NÃO se apaga (só aceita inserção, e o registro de quem
// excluiu é justamente o que sobra).
const KEEP = new Set(['audit_events']);

export type DeletedAccount = { adminEmails: string[]; members: number };

// Só as chaves que IMPEDEM apagar o pai com filho vivo (no action e restrict) impõem ordem. As de
// cascade e de set null resolvem sozinhas (e é por isso que posts e scheduled_posts, que apontam um
// para o outro com set null, não formam um ciclo que importe).
const EDGES_SQL = `
  select c.relname as child, p.relname as parent
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_class p on p.oid = k.confrelid
  where k.contype = 'f' and k.confdeltype in ('a', 'r') and c.relnamespace = 'public'::regnamespace`;

export async function deleteAccount(input: { tenantId: string; actorUserId: string; kind: string }, store: BlobStore = defaultStore()): Promise<DeletedAccount> {
  const client = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  const tables = TENANT_TABLES.filter((t) => !KEEP.has(t));
  let result: DeletedAccount = { adminEmails: [], members: 0 };

  await client.transaction(async (tx) => {
    const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => ((await tx.query(text, params)) as { rows: T[] }).rows;

    const exists = await q('select id from tenants where id = $1 for update', [input.tenantId]);
    if (exists.length === 0) throw new Error('conta não encontrada');

    // Quem avisar: os outros administradores. Lido antes de apagar as membresias.
    const admins = await q<{ email: string }>(
      "select u.email from tenant_members m join users u on u.id = m.user_id where m.tenant_id = $1 and m.role = 'admin' and m.user_id <> $2 and u.email is not null",
      [input.tenantId, input.actorUserId],
    );
    const members = await q<{ n: number }>('select count(*)::int as n from tenant_members where tenant_id = $1', [input.tenantId]);
    result = { adminEmails: admins.map((r) => r.email), members: members[0]?.n ?? 0 };

    await recordAudit(tx.query, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'account.deleted',
      targetType: 'tenant',
      targetId: input.tenantId,
      metadata: { kind: input.kind, members: result.members },
    });

    const edges = (await q<{ child: string; parent: string }>(EDGES_SQL)).map((r) => [r.child, r.parent] as const);
    for (const table of deletionOrder(tables, edges)) {
      await tx.query(`delete from "${table}" where tenant_id = $1`, [input.tenantId]);
    }
    await tx.query('update users set last_tenant_id = null where last_tenant_id = $1', [input.tenantId]);
    await tx.query('delete from tenants where id = $1', [input.tenantId]);
  });

  // Os arquivos saem só depois de a conta ter saído do banco. Se falhar, sobra objeto órfão: vai
  // para o log como erro (e para o Sentry), com o caminho, para limpar à mão.
  await store.removePrefix(`tenants/${input.tenantId}/`).catch((e) =>
    log('error', 'account-deletion', 'não apagou os arquivos da conta do bucket', { prefix: `tenants/${input.tenantId}/`, error: e instanceof Error ? e.message : String(e) }),
  );
  return result;
}
