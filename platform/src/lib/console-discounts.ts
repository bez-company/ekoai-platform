// console-discounts.ts: o desconto de preço por conta, lido e gravado pelo Console › Financeiro (SPEC 032). Uso de sistema: atravessa as
// contas de propósito (só a administradora da plataforma chega aqui, pelo portão do console), por isso usa db() direto. A tabela não tem
// `tenant_id` nem política de RLS: o desconto nunca sai na exportação de dados da conta nem chega a uma tela de cliente.

import { db } from './db';
import { recordAudit } from './audit';
import { NotFoundError } from './errors';
import { dayBefore, dayOf, type Discount, type DiscountInput } from './price-model';
import type { DbClient } from '@ekoai/db';

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export type AccountDiscount = Discount & { id: string; reason: string };

const COLUMNS = "id, discount_percent, reason, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on";

const toDiscount = (r: Record<string, unknown>): AccountDiscount => ({
  id: String(r.id),
  discountPercent: Number(r.discount_percent),
  reason: String(r.reason ?? ''),
  startsOn: String(r.starts_on),
  endsOn: r.ends_on ? String(r.ends_on) : null,
});

// Todos os descontos de uma conta, do mais novo ao mais antigo.
export async function listDiscounts(accountId: string): Promise<AccountDiscount[]> {
  const res = await db().query(`select ${COLUMNS} from account_price_discounts where account_id = $1 order by starts_on desc, created_at desc`, [accountId]);
  return (res.rows as Record<string, unknown>[]).map(toDiscount);
}

// Os descontos de todas as contas, por conta: o console de finanças precisa do desconto de cada post, que depende do dia em que foi criado.
export async function discountsByAccount(): Promise<Map<string, AccountDiscount[]>> {
  const res = await db().query(`select account_id, ${COLUMNS} from account_price_discounts order by starts_on desc, created_at desc`);
  const out = new Map<string, AccountDiscount[]>();
  for (const r of res.rows as Record<string, unknown>[]) {
    const list = out.get(String(r.account_id)) ?? [];
    list.push(toDiscount(r));
    out.set(String(r.account_id), list);
  }
  return out;
}

async function inTransaction<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client: DbClient = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  return client.transaction(async (tx) => fn(tx.query as unknown as Q));
}

// Encerra o desconto que vale hoje. O que começou hoje (ou depois) some, porque ainda não precificou nenhum post de um período passado; o que
// começou antes termina ontem, e os posts dele mantêm o preço.
async function closeFrom(q: Q, accountId: string, today: string): Promise<void> {
  await q('delete from account_price_discounts where account_id = $1 and starts_on >= $2', [accountId, today]);
  await q('update account_price_discounts set ends_on = $3 where account_id = $1 and starts_on < $2 and (ends_on is null or ends_on >= $2)', [accountId, today, dayBefore(today)]);
}

async function requireAccount(q: Q, accountId: string): Promise<void> {
  const res = await q('select id from tenants where id = $1 for update', [accountId]);
  if (res.rows.length === 0) throw new NotFoundError('Essa conta não existe mais. Volte para a lista.');
}

// Aplica um desconto a partir de hoje, no lugar do que valia. Só o fato de ter mudado vai para a auditoria, sem o tenant (o registro de
// atividade da conta é visto pelo cliente) e sem os valores.
export async function setAccountDiscount(accountId: string, input: DiscountInput, actorId: string, now: Date = new Date()): Promise<void> {
  const today = dayOf(now);
  await inTransaction(async (q) => {
    await requireAccount(q, accountId);
    await closeFrom(q, accountId, today);
    await q('insert into account_price_discounts (account_id, discount_percent, reason, starts_on, ends_on, created_by) values ($1, $2, $3, $4, $5, $6)', [
      accountId,
      input.discountPercent,
      input.reason,
      today,
      input.endsOn,
      actorId,
    ]);
    await recordAudit(q, { tenantId: null, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.account_discount_set', targetType: 'account', targetId: accountId });
  });
}

export async function endAccountDiscount(accountId: string, actorId: string, now: Date = new Date()): Promise<void> {
  const today = dayOf(now);
  await inTransaction(async (q) => {
    await requireAccount(q, accountId);
    await closeFrom(q, accountId, today);
    await recordAudit(q, { tenantId: null, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.account_discount_ended', targetType: 'account', targetId: accountId });
  });
}
