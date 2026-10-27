// account-plan.ts: o upgrade de Individual para Time e o pedido de contato da Agência (SPEC 025, BEZ-376). O upgrade troca o
// tipo da conta e o plano numa linha só (o gatilho check_tenant_plan exige plano do mesmo tipo) e não apaga nada. A cobrança
// do usuário adicional começa quando um convidado aceita (SPEC 021). O pedido da Agência fica na auditoria da conta: nada é cobrado.

import { db } from './db';
import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { auditTenant } from './audit';
import { notify } from './notifications';
import { PLAN_BY_KIND } from './account-model';

export async function upgradeToTime(t: TenantDb, actor: SessionUser): Promise<void> {
  // sistema: `tenants` não tem tenant_id (a linha é a própria conta); o filtro por id e por tipo é a trava
  const { rows } = await db().query("update tenants set kind = 'empresa', plan_id = $2 where id = $1 and kind = 'pessoa' returning id", [t.tenantId, PLAN_BY_KIND.empresa]);
  if (!rows.length) throw new UserError('Esta conta já é de equipe. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'plan.upgraded', targetType: 'tenant', targetId: t.tenantId, metadata: { from: 'individual', to: 'time' } });
  await notify(t, { kind: 'account.plan_changed', title: 'A conta agora é Time', body: 'Você já pode convidar pessoas. O primeiro usuário continua grátis.', link: '/configuracoes/equipe', audience: 'admin' });
}

export async function requestAgency(t: TenantDb, actor: SessionUser, input: { brands: number; note: string | null }): Promise<void> {
  await auditTenant(t, { actorUserId: actor.id, action: 'plan.agency_requested', targetType: 'tenant', targetId: t.tenantId, metadata: { brands: input.brands, note: input.note } });
  await notify(t, { kind: 'account.plan_changed', title: 'Pedido de Agência enviado', body: 'A equipe da Ekoai responde em até 2 dias úteis. Nada foi cobrado.', audience: 'admin' });
}
