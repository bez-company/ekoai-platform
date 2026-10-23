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
import { inviteStatus, type InviteStatus } from './invitation-model';

export type SessionUser = { id: string; sessionVersion: number; lastTenantId: string | null; name: string | null };

const USER_COLUMNS = 'id,session_version,last_tenant_id,name';

function toUser(row: Record<string, unknown>): SessionUser {
  return {
    id: String(row.id),
    sessionVersion: Number(row.session_version),
    lastTenantId: (row.last_tenant_id as string | null) ?? null,
    name: (row.name as string | null) ?? null,
  };
}

// Acha a pessoa pelo id do provedor; no primeiro login, liga a linha criada por convite (só
// e-mail) pelo e-mail verificado; senão cria. Só chamar depois de identityRefusal().
export async function findOrLinkUser(id: Identity): Promise<SessionUser> {
  const user = await resolveUser(id);
  // O nome digitado no cadastro entra uma vez; mudar depois é do perfil, não do login.
  if (id.name && !user.name) {
    const named = await db().from('users').update({ name: id.name }).eq('id', user.id).is('name', null);
    if (named.error) throw new Error(`nome em users: ${named.error.message}`);
    return { ...user, name: id.name };
  }
  return user;
}

async function resolveUser(id: Identity): Promise<SessionUser> {
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
        await tx.query(
          "insert into notifications (tenant_id, kind, level, title, body, link, audience) values ($1, 'account.created', 'info', 'Conta criada', 'A publicação começa pausada até você revisar os horários.', '/configuracoes', 'admin')",
          [id],
        );
      });
      return id;
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'tenants_pkey') continue;
      throw e;
    }
  }
  throw new Error('não achei um identificador livre para a conta');
}

export type PlanInfo = { id: string; name: string; kind: AccountKind; maxSeats: number; maxInstagramAccounts: number; maxPostsPerMonth: number };
export type AccountInfo = { id: string; name: string; kind: AccountKind; plan: PlanInfo };

// Nome, tipo e limites do plano da conta (a tela de equipe mostra "3 de 5 pessoas").
export async function accountOf(tenantId: string): Promise<AccountInfo | null> {
  const t = await db().from('tenants').select('id,name,kind,plan_id').eq('id', tenantId).maybeSingle();
  if (t.error) throw new Error(`tenants: ${t.error.message}`);
  if (!t.data) return null;
  const p = await db().from('plans').select('id,name,kind,max_seats,max_instagram_accounts,max_posts_per_month').eq('id', t.data.plan_id).single();
  if (p.error) throw new Error(`plans: ${p.error.message}`);
  const plan: PlanInfo = {
    id: String(p.data.id),
    name: String(p.data.name),
    kind: p.data.kind as AccountKind,
    maxSeats: Number(p.data.max_seats),
    maxInstagramAccounts: Number(p.data.max_instagram_accounts),
    maxPostsPerMonth: Number(p.data.max_posts_per_month ?? 20),
  };
  return { id: String(t.data.id), name: String(t.data.name), kind: t.data.kind as AccountKind, plan };
}

export type PersonProfile = { email: string; name: string | null };

// E-mail e nome de várias pessoas de uma vez (a tabela users não tem tenant_id: quem chama já
// filtrou pelos membros da conta da sessão).
export async function personProfiles(userIds: string[]): Promise<Map<string, PersonProfile>> {
  const out = new Map<string, PersonProfile>();
  if (userIds.length === 0) return out;
  const { data, error } = await db().from('users').select('id,email,name').in('id', userIds);
  if (error) throw new Error(`users: ${error.message}`);
  for (const r of data ?? []) out.set(String(r.id), { email: String(r.email), name: (r.name as string | null) ?? null });
  return out;
}

export async function userIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await db().from('users').select('id').eq('email', email).maybeSingle();
  if (error) throw new Error(`users por e-mail: ${error.message}`);
  return data ? String(data.id) : null;
}

// Aceita o convite e registra a entrada na auditoria na mesma transação. Devolve a conta. Os
// erros de app.accept_invitation() chegam com mensagem fixa (invitation-model.ts os traduz).
export async function acceptInvitation(userId: string, tokenHash: string): Promise<string> {
  const client = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  return client.transaction(async (tx) => {
    const res = await tx.query('select app.accept_invitation($1, $2) as tenant_id', [tokenHash, userId]);
    const tenantId = String(res.rows[0].tenant_id);
    await recordAudit(tx.query, { tenantId, actorUserId: userId, action: 'team.member_joined', targetType: 'user', targetId: userId });
    return tenantId;
  });
}

export type InvitePreview = {
  status: InviteStatus;
  accountName: string;
  role: Role;
  email: string;
  inviterName: string | null;
  expiresAt: string;
};

// O que a página do convite mostra antes de entrar. Quem tem o link tem o token, então o e-mail
// convidado pode aparecer (ajuda a notar que entrou com o e-mail errado); o e-mail de quem
// convidou, não.
export async function previewInvitation(tokenHash: string): Promise<InvitePreview | null> {
  const res = await db().query(
    `select i.email, i.role, i.expires_at, i.accepted_at, i.cancelled_at, t.name as account_name, u.name as inviter_name
     from invitations i join tenants t on t.id = i.tenant_id left join users u on u.id = i.invited_by
     where i.token_hash = $1`,
    [tokenHash],
  );
  const r = res.rows[0];
  if (!r || !isRole(r.role)) return null;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  return {
    status: inviteStatus({ expires_at: iso(r.expires_at) as string, accepted_at: iso(r.accepted_at), cancelled_at: iso(r.cancelled_at) }),
    accountName: String(r.account_name),
    role: r.role,
    email: String(r.email),
    inviterName: (r.inviter_name as string | null) ?? null,
    expiresAt: iso(r.expires_at) as string,
  };
}


// Passos opcionais do checklist de Início que a conta pulou (migration 0021). Tabela de conta
// sem coluna tenant_id (a chave é `id`), por isso passa por aqui e não pelo tenantDb.
export async function onboardingSkipped(tenantId: string): Promise<string[]> {
  const { data, error } = await db().from('tenants').select('onboarding_skipped').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`onboarding: ${error.message}`);
  return Array.isArray(data?.onboarding_skipped) ? (data.onboarding_skipped as unknown[]).map(String) : [];
}

export async function setOnboardingSkip(tenantId: string, item: string, skipped: boolean): Promise<void> {
  const current = await onboardingSkipped(tenantId);
  const next = skipped ? [...new Set([...current, item])] : current.filter((i) => i !== item);
  const { error } = await db().from('tenants').update({ onboarding_skipped: next }).eq('id', tenantId);
  if (error) throw new Error(`onboarding: ${error.message}`);
}

// O id da pessoa no provedor de login (idp_uid), para conferir que um ID token novo é dela.
export async function idpUidOf(userId: string): Promise<string | null> {
  const { data, error } = await db().from('users').select('idp_uid').eq('id', userId).maybeSingle();
  if (error) throw new Error(`users: ${error.message}`);
  return typeof data?.idp_uid === 'string' ? data.idp_uid : null;
}
