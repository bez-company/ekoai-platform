// accounts.ts: pessoas, contas e permissões lidas do banco para o login e a sessão (SPEC 009).
// Uso de sistema: atravessa tenants de propósito (uma pessoa pode estar em várias contas), por
// isso usa db() direto em vez do tenantDb. Nada aqui recebe tenant do corpo da requisição sem
// conferir a membership.

import { db } from './db';
import type { Identity } from './identity';
import type { Membership } from './login-policy';
import { isRole, type Permission, type Role, allows } from './permissions';
import { PLAN_BY_KIND, candidateIds, type AccountKind } from './account-model';
import { recordAudit } from './audit';

export type SessionUser = { id: string; sessionVersion: number; lastTenantId: string | null };

const USER_COLUMNS = 'id,session_version,last_tenant_id';

function toUser(row: Record<string, unknown>): SessionUser {
  return { id: String(row.id), sessionVersion: Number(row.session_version), lastTenantId: (row.last_tenant_id as string | null) ?? null };
}

// Acha a pessoa pelo id do provedor; no primeiro login, liga a linha criada por convite (só
// e-mail) pelo e-mail verificado; senão cria. Só chamar depois de identityRefusal().
export async function findOrLinkUser(id: Identity): Promise<SessionUser> {
  if (!id.email) throw new Error('identidade sem e-mail');
  const byUid = await db().from('users').select(USER_COLUMNS).eq('idp_uid', id.uid).maybeSingle();
  if (byUid.error) throw new Error(`users por idp_uid: ${byUid.error.message}`);
  if (byUid.data) return toUser(byUid.data);

  const linked = await db()
    .from('users')
    .update({ idp_uid: id.uid })
    .eq('email', id.email)
    .is('idp_uid', null)
    .select(USER_COLUMNS)
    .maybeSingle();
  if (linked.error) throw new Error(`ligar users por e-mail: ${linked.error.message}`);
  if (linked.data) return toUser(linked.data);

  const created = await db().from('users').insert({ email: id.email, idp_uid: id.uid }).select(USER_COLUMNS).single();
  if (created.error) throw new Error(`criar users: ${created.error.message}`);
  return toUser(created.data);
}

export async function membershipsOf(userId: string): Promise<Membership[]> {
  const { data, error } = await db().from('tenant_members').select('tenant_id,role,created_at').eq('user_id', userId);
  if (error) throw new Error(`memberships: ${error.message}`);
  return (data ?? [])
    .filter((r) => isRole(r.role))
    .map((r) => ({ tenantId: String(r.tenant_id), role: r.role as Role, createdAt: String(r.created_at) }));
}

export async function sessionUser(userId: string): Promise<SessionUser | null> {
  const { data, error } = await db().from('users').select(USER_COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw new Error(`users: ${error.message}`);
  return data ? toUser(data) : null;
}

export async function roleIn(userId: string, tenantId: string): Promise<Role | null> {
  const { data, error } = await db()
    .from('tenant_members')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`membership: ${error.message}`);
  return data && isRole(data.role) ? data.role : null;
}

export async function hasPermission(role: Role, tenantId: string, permission: Permission): Promise<boolean> {
  const [granted, tenant] = await Promise.all([
    db().from('role_permissions').select('permission').eq('role', role),
    db().from('tenants').select('creator_can_approve').eq('id', tenantId).maybeSingle(),
  ]);
  if (granted.error) throw new Error(`role_permissions: ${granted.error.message}`);
  if (tenant.error) throw new Error(`tenants: ${tenant.error.message}`);
  const set = new Set((granted.data ?? []).map((r) => String(r.permission)));
  return allows(role, set, permission, tenant.data?.creator_can_approve === true);
}

export async function markLogin(userId: string, tenantId: string): Promise<void> {
  const { error } = await db()
    .from('users')
    .update({ last_tenant_id: tenantId, last_login_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(`marcar login: ${error.message}`);
}

// "Sair de todos os dispositivos": toda sessão com a versão anterior deixa de valer.
export async function bumpSessionVersion(user: SessionUser): Promise<void> {
  const { error } = await db()
    .from('users')
    .update({ session_version: user.sessionVersion + 1 })
    .eq('id', user.id)
    .eq('session_version', user.sessionVersion);
  if (error) throw new Error(`subir versão da sessão: ${error.message}`);
}

// Cria a conta e o primeiro administrador numa transação só (uma conta sem administrador não tem
// como ser usada nem corrigida pela tela). O identificador vem do nome; se já existir, tenta com
// sufixo. A conta nasce pausada (trigger da 0013) e no plano do tipo (0017).
export async function createAccount(input: { userId: string; name: string; kind: AccountKind }): Promise<string> {
  const client = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  for (const id of candidateIds(input.name)) {
    try {
      await client.transaction(async (tx) => {
        await tx.query('insert into tenants (id, name, kind, plan_id) values ($1, $2, $3, $4)', [id, input.name, input.kind, PLAN_BY_KIND[input.kind]]);
        await tx.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [id, input.userId]);
        await recordAudit(tx.query, {
          tenantId: id,
          actorUserId: input.userId,
          action: 'account.created',
          targetType: 'tenant',
          targetId: id,
          metadata: { kind: input.kind },
        });
      });
      return id;
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'tenants_pkey') continue;
      throw e;
    }
  }
  throw new Error('não achei um identificador livre para a conta');
}
