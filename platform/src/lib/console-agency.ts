// console-agency.ts: o plano Agência no console do administrador da plataforma (SPEC 039, BEZ-265). Uso de sistema:
// atravessa contas de propósito, por isso usa db() direto, e só é chamado depois de requirePlatformAdmin(). Toda gravação
// deixa um evento em audit_events (actor_kind platform_admin) na mesma transação.
//
// O pedido "Falar com a Ekoai" de Perfil › Conta e plano grava `plan.agency_requested` na auditoria da conta; o console lê
// esses pedidos aqui e liga o plano com um clique.

import { PLAN_BY_KIND } from './account-model';
import { AGENCY_PLAN_ID } from './agency-model';
import { recordAudit } from './audit';
import { db } from './db';
import { ConflictError, NotFoundError } from './errors';

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export type AgencyRequest = { tenantId: string; name: string; brands: number | null; note: string | null; requestedAt: string; isAgency: boolean };

// O pedido mais recente de cada conta, do mais novo para o mais antigo (até 50).
export async function listAgencyRequests(): Promise<AgencyRequest[]> {
  const { rows } = await db().query(
    `select distinct on (e.tenant_id) e.tenant_id, t.name, t.plan_id, e.metadata, e.created_at
     from audit_events e join tenants t on t.id = e.tenant_id
     where e.action = 'plan.agency_requested'
     order by e.tenant_id, e.created_at desc`,
  );
  return rows
    .map((r) => {
      const m = (r.metadata ?? {}) as { brands?: unknown; note?: unknown };
      return {
        tenantId: String(r.tenant_id),
        name: String(r.name),
        brands: typeof m.brands === 'number' ? m.brands : null,
        note: typeof m.note === 'string' ? m.note : null,
        requestedAt: iso(r.created_at),
        isAgency: r.plan_id === AGENCY_PLAN_ID,
      };
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 50);
}

export type ConsoleAgency = {
  isAgency: boolean;
  agency: { id: string; name: string } | null;
  clients: { id: string; name: string; instagram: string | null }[];
};

// No detalhe da conta: se é agência (com os clientes) ou cliente de qual agência.
export async function consoleAgencyOf(id: string): Promise<ConsoleAgency> {
  const { rows } = await db().query(
    `select t.plan_id, a.id as agency_id, a.name as agency_name,
            coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name,
                       'instagram', (select sa.handle from social_accounts sa where sa.tenant_id = c.id and sa.channel = 'instagram' and sa.status <> 'revoked' order by sa.connected_at desc limit 1))
                       order by c.name)
                      from tenants c where c.agency_id = t.id), '[]'::json) as clients
     from tenants t left join tenants a on a.id = t.agency_id
     where t.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return { isAgency: false, agency: null, clients: [] };
  const clients = (r.clients as { id: string; name: string; instagram: string | null }[]) ?? [];
  return { isAgency: r.plan_id === AGENCY_PLAN_ID, agency: r.agency_id ? { id: String(r.agency_id), name: String(r.agency_name) } : null, clients };
}

// Liga ou desliga o plano Agência. Ligar troca o tipo para empresa (o plano é de empresa); desligar volta ao Time e o
// banco recusa enquanto houver clientes (migration 0067). Cliente de outra agência não vira agência.
export async function setAgencyOnAccount(id: string, actorId: string, on: boolean): Promise<void> {
  const client = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  await client.transaction(async (tx) => {
    const q = tx.query as unknown as Q;
    const cur = (await q('select plan_id, agency_id from tenants where id = $1 for update', [id])).rows[0];
    if (!cur) throw new NotFoundError('Essa conta não existe mais. Volte para a lista.');
    if (on) {
      if (cur.plan_id === AGENCY_PLAN_ID) throw new ConflictError('Essa conta já é agência.');
      if (cur.agency_id) throw new ConflictError('Essa conta é cliente de uma agência e não pode virar agência.');
      await q("update tenants set kind = 'empresa', plan_id = $2 where id = $1", [id, AGENCY_PLAN_ID]);
      await q(
        "insert into notifications (tenant_id, kind, level, title, body, link, audience) values ($1, 'account.plan_changed', 'info', 'A conta agora é Agência', 'Cadastre os clientes em Clientes: cada um tem a própria marca, agenda e Instagram.', '/clientes', 'admin')",
        [id],
      );
      await recordAudit(q, { tenantId: id, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.agency_enabled', targetType: 'tenant', targetId: id, metadata: { from: String(cur.plan_id) } });
      return;
    }
    if (cur.plan_id !== AGENCY_PLAN_ID) throw new ConflictError('Essa conta não é agência.');
    const clients = (await q('select count(*)::int as n from tenants where agency_id = $1', [id])).rows[0];
    if (Number(clients?.n ?? 0) > 0) throw new ConflictError('A agência ainda tem clientes. Ela só deixa de ser agência sem nenhum cliente.');
    await q('update tenants set plan_id = $2 where id = $1', [id, PLAN_BY_KIND.empresa]);
    await recordAudit(q, { tenantId: id, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.agency_disabled', targetType: 'tenant', targetId: id });
  });
}
