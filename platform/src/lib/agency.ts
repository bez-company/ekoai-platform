// agency.ts: a agência e as contas dos clientes dela (SPEC 039, ADR 0032, BEZ-265). Server-only.
//
// Cada cliente é uma conta da Ekoai como outra qualquer: marca, fatos, regras, agenda e o Instagram dela, isolados pelo
// tenant. A agência só agrupa: `tenants.agency_id` aponta para ela e os administradores dela entram como administradores
// do cliente. Trocar de conta é a mesma rota de sempre (POST /api/auth/tenant). Atravessa contas de propósito (a agência
// lê e cria as contas dos clientes), por isso usa db() direto, sempre filtrando pela agência da sessão.

import { candidateIds } from './account-model';
import { recordAudit } from './audit';
import { db } from './db';
import { UserError } from './errors';
import { AGENCY_PLAN_ID, type ClientInstagram, type SwitchAccount } from './agency-model';
import type { SessionUser } from './accounts';

export type AgencyContext = { isAgency: boolean; agency: { id: string; name: string } | null };

// Se a conta é agência e, se for cliente, de qual agência.
export async function agencyContext(tenantId: string): Promise<AgencyContext> {
  const { rows } = await db().query(
    `select t.plan_id, a.id as agency_id, a.name as agency_name
     from tenants t left join tenants a on a.id = t.agency_id
     where t.id = $1`,
    [tenantId],
  );
  const r = rows[0];
  if (!r) return { isAgency: false, agency: null };
  return { isAgency: r.plan_id === AGENCY_PLAN_ID, agency: r.agency_id ? { id: String(r.agency_id), name: String(r.agency_name) } : null };
}

export type ClientRow = {
  id: string;
  name: string;
  suspended: boolean;
  instagram: ClientInstagram;
  member: boolean;
  createdAt: string;
};

// Os clientes da agência, com o Instagram de cada um e se quem pede entra nele (é membro).
export async function listClients(agencyId: string, userId: string): Promise<ClientRow[]> {
  const { rows } = await db().query(
    `select t.id, t.name, t.status, t.created_at,
            ig.handle as ig_handle, ig.status as ig_status,
            exists (select 1 from tenant_members m where m.tenant_id = t.id and m.user_id = $2) as member
     from tenants t
     left join lateral (
       select sa.handle, sa.status from social_accounts sa
       where sa.tenant_id = t.id and sa.channel = 'instagram' and sa.status <> 'revoked'
       order by sa.connected_at desc limit 1
     ) ig on true
     where t.agency_id = $1
     order by t.name`,
    [agencyId, userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    suspended: r.status === 'suspended',
    instagram: r.ig_status ? { handle: (r.ig_handle as string | null) ?? null, status: r.ig_status === 'active' ? 'active' : 'reauth_required' } : null,
    member: r.member === true,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

// Cria a conta do cliente dentro da agência, numa transação só: a conta (tipo empresa, plano Time, `agency_id`), os
// administradores da agência como administradores dela, a auditoria nas duas contas e o primeiro aviso. Sem limite de
// clientes (a cobrança é por marca). A publicação já nasce ligada, como quando a pessoa cria a própria conta: sem
// Instagram e sem horário, nada sai.
export async function createClient(agencyId: string, actor: SessionUser, name: string): Promise<string> {
  const client = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  for (const id of candidateIds(name)) {
    try {
      await client.transaction(async (tx) => {
        const agency = await tx.query('select plan_id, agency_id, status from tenants where id = $1 for update', [agencyId]);
        const a = agency.rows[0];
        if (!a || a.plan_id !== AGENCY_PLAN_ID || a.agency_id) throw new UserError('Esta conta não é uma agência. Peça o plano Agência em Perfil, Conta e plano.');
        if (a.status === 'suspended') throw new UserError('A conta da agência está suspensa. Fale com a Ekoai.');
        await tx.query("insert into tenants (id, name, kind, plan_id, agency_id) values ($1, $2, 'empresa', 'inicial', $3)", [id, name, agencyId]);
        await tx.query(
          `insert into tenant_members (tenant_id, user_id, role)
           select $1, m.user_id, 'admin' from tenant_members m where m.tenant_id = $2 and m.role = 'admin'
           union select $1, $3::uuid, 'admin'
           on conflict do nothing`,
          [id, agencyId, actor.id],
        );
        await recordAudit(tx.query, { tenantId: id, actorUserId: actor.id, action: 'account.created', targetType: 'tenant', targetId: id, metadata: { kind: 'empresa', agency: agencyId } });
        await recordAudit(tx.query, { tenantId: agencyId, actorUserId: actor.id, action: 'agency.client_created', targetType: 'tenant', targetId: id, metadata: { name } });
        await tx.query('update publishing_controls set paused = false, reason = null, paused_at = null, updated_at = now() where tenant_id = $1', [id]);
        await tx.query(
          "insert into notifications (tenant_id, kind, level, title, body, link, audience) values ($1, 'account.created', 'info', 'Conta do cliente criada', 'Conecte o Instagram do cliente e escolha os horários na Agenda: os posts aprovados saem neles.', '/configuracoes/canais', 'admin')",
          [id],
        );
      });
      return id;
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'tenants_pkey') continue;
      throw e;
    }
  }
  throw new Error('não achei um identificador livre para a conta do cliente');
}

// As contas que a pessoa abre, para o seletor do menu. Conta suspensa fica de fora (ninguém entra nela).
export async function switchableAccounts(userId: string): Promise<SwitchAccount[]> {
  const { rows } = await db().query(
    `select t.id, t.name, t.agency_id, t.plan_id
     from tenant_members m join tenants t on t.id = m.tenant_id
     where m.user_id = $1 and t.status <> 'suspended'`,
    [userId],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), agencyId: (r.agency_id as string | null) ?? null, isAgency: r.plan_id === AGENCY_PLAN_ID }));
}
