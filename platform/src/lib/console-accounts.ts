// console-accounts.ts: o que o console do administrador da plataforma lê e grava sobre as contas
// (BEZ-303). Uso de sistema: atravessa contas de propósito, por isso usa db() direto, e só é chamado
// depois de requirePlatformAdmin(). Toda gravação deixa um evento em audit_events (actor_kind
// platform_admin), na mesma transação.

import type { DbClient } from '@ekoai/db';
import { candidateIds, PLAN_BY_KIND, type AccountKind } from './account-model';
import { db } from './db';
import { recordAudit } from './audit';
import { accountStatus, type AccountQuery, type AccountStatus } from './console-model';
import { ConflictError, NotFoundError, UserError } from './errors';
import { INVITE_TTL_DAYS, hashInviteToken, inviteStatus, newInviteToken, type InviteStatus } from './invitation-model';
import { isRole, type Role } from './permissions';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export type AccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  planName: string;
  status: AccountStatus;
  people: number;
  instagram: string | null;
  createdAt: string;
};

// `%` e `_` digitados na busca valem como texto, não como curinga.
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Até 200 contas, da mais nova para a mais antiga. O filtro por status roda aqui porque "pausada"
// vem de outra tabela e a lista é curta.
export async function listAccounts(query: AccountQuery): Promise<{ rows: AccountRow[]; total: number; active: number }> {
  const pattern = `%${likeEscape(query.search)}%`;
  const res = await db().query(
    `select t.id, t.name, t.kind, p.name as plan_name, t.status, t.created_at,
            coalesce(pc.paused, false) as paused,
            (select count(*)::int from tenant_members m where m.tenant_id = t.id) as people,
            (select sa.handle from social_accounts sa
              where sa.tenant_id = t.id and sa.channel = 'instagram' and sa.status <> 'revoked'
              order by sa.connected_at limit 1) as instagram
     from tenants t
     join plans p on p.id = t.plan_id
     left join publishing_controls pc on pc.tenant_id = t.id
     where ($1 = '' or t.name ilike $2 or t.id ilike $2
            or exists (select 1 from tenant_members m join users u on u.id = m.user_id where m.tenant_id = t.id and u.email ilike $2))
     order by t.created_at desc
     limit 200`,
    [query.search, pattern],
  );
  const all: AccountRow[] = res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as AccountKind,
    planName: String(r.plan_name),
    status: accountStatus({ status: String(r.status), paused: r.paused === true }),
    people: Number(r.people),
    instagram: (r.instagram as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
  }));
  return {
    rows: query.status === 'all' ? all : all.filter((a) => a.status === query.status),
    total: all.length,
    active: all.filter((a) => a.status === 'active').length,
  };
}

export type AccountPerson = { userId: string; email: string; name: string | null; role: Role; lastLoginAt: string | null };
export type AccountInvite = { id: string; email: string; role: Role; status: InviteStatus; expiresAt: string };
export type AccountNetwork = { channel: string; handle: string | null; status: string; expiresAt: string | null };
export type AccountNotice = { title: string; level: string; createdAt: string };

export type AccountDetail = {
  id: string;
  name: string;
  kind: AccountKind;
  status: AccountStatus;
  suspended: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  plan: { id: string; name: string; maxSeats: number; maxInstagramAccounts: number; maxPostsPerMonth: number; maxNetworks: number };
  people: AccountPerson[];
  invitations: AccountInvite[];
  networks: AccountNetwork[];
  usage: { seats: number; instagram: number; postsPublished: number; generations: number };
  notices: AccountNotice[];
};

export async function getAccount(id: string): Promise<AccountDetail | null> {
  const client = db();
  const t = await client.query(
    `select t.id, t.name, t.kind, t.status, t.suspended_at, t.suspended_reason, t.created_at,
            p.id as plan_id, p.name as plan_name, p.max_seats, p.max_instagram_accounts, p.max_posts_per_month, p.max_networks,
            coalesce(pc.paused, false) as paused
     from tenants t join plans p on p.id = t.plan_id left join publishing_controls pc on pc.tenant_id = t.id
     where t.id = $1`,
    [id],
  );
  const row = t.rows[0];
  if (!row) return null;

  const [members, invites, networks, notices, posts, gens] = await Promise.all([
    client.query(
      `select m.user_id, m.role, u.email, u.name, u.last_login_at from tenant_members m join users u on u.id = m.user_id
       where m.tenant_id = $1 order by m.created_at`,
      [id],
    ),
    client.query(
      `select id, email, role, expires_at, accepted_at, cancelled_at from invitations
       where tenant_id = $1 and accepted_at is null and cancelled_at is null order by created_at desc`,
      [id],
    ),
    client.query(
      `select channel, handle, status, expires_at from social_accounts where tenant_id = $1 and status <> 'revoked' order by connected_at`,
      [id],
    ),
    client.query(`select title, level, created_at from notifications where tenant_id = $1 order by created_at desc limit 3`, [id]),
    client.query(
      `select count(*)::int as n from scheduled_posts
       where tenant_id = $1 and status = 'published' and published_at >= date_trunc('month', now())`,
      [id],
    ),
    client.query(
      `select count(*)::int as n from generation_runs
       where tenant_id = $1 and status = 'done' and created_at >= date_trunc('month', now())`,
      [id],
    ),
  ]);

  const people: AccountPerson[] = members.rows
    .filter((r) => isRole(r.role))
    .map((r) => ({ userId: String(r.user_id), email: String(r.email), name: (r.name as string | null) ?? null, role: r.role as Role, lastLoginAt: iso(r.last_login_at) }));
  const invitations: AccountInvite[] = invites.rows
    .filter((r) => isRole(r.role))
    .map((r) => ({
      id: String(r.id),
      email: String(r.email),
      role: r.role as Role,
      status: inviteStatus({ expires_at: iso(r.expires_at) as string }),
      expiresAt: iso(r.expires_at) as string,
    }));
  const networkRows: AccountNetwork[] = networks.rows.map((r) => ({
    channel: String(r.channel),
    handle: (r.handle as string | null) ?? null,
    status: String(r.status),
    expiresAt: iso(r.expires_at),
  }));

  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as AccountKind,
    status: accountStatus({ status: String(row.status), paused: row.paused === true }),
    suspended: row.status === 'suspended',
    suspendedAt: iso(row.suspended_at),
    suspendedReason: (row.suspended_reason as string | null) ?? null,
    createdAt: iso(row.created_at) as string,
    plan: {
      id: String(row.plan_id),
      name: String(row.plan_name),
      maxSeats: Number(row.max_seats),
      maxInstagramAccounts: Number(row.max_instagram_accounts),
      maxPostsPerMonth: Number(row.max_posts_per_month),
      maxNetworks: Number(row.max_networks),
    },
    people,
    invitations,
    networks: networkRows,
    usage: {
      // As vagas contam equipe e convites pendentes, como o gatilho do banco.
      seats: people.length + invitations.filter((i) => i.status === 'pending').length,
      instagram: networkRows.filter((n) => n.channel === 'instagram').length,
      postsPublished: Number(posts.rows[0]?.n ?? 0),
      generations: Number(gens.rows[0]?.n ?? 0),
    },
    notices: notices.rows.map((r) => ({ title: String(r.title), level: String(r.level), createdAt: iso(r.created_at) as string })),
  };
}

// Suspende: ninguém da conta entra (session.ts e o login conferem tenants.status) e nada é publicado
// (a publicação também fica pausada, para a conta voltar pausada e quem a reativa conferir os
// horários antes de retomar). O motivo vai para a conta e para o registro de auditoria.
export async function suspendAccount(id: string, actorId: string, reason: string): Promise<void> {
  await inTransaction(async (q) => {
    const res = await q("update tenants set status = 'suspended', suspended_at = now(), suspended_reason = $2 where id = $1 and status = 'active' returning id", [id, reason]);
    if (res.rows.length === 0) await explainNoChange(q, id, 'suspended');
    await q(
      `insert into publishing_controls (tenant_id, paused, reason, paused_at, updated_at) values ($1, true, 'Conta suspensa', now(), now())
       on conflict (tenant_id) do update set paused = true, reason = 'Conta suspensa', paused_at = coalesce(publishing_controls.paused_at, now()), updated_at = now()`,
      [id],
    );
    await recordAudit(q, { tenantId: id, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.account_suspended', targetType: 'tenant', targetId: id, metadata: { reason } });
  });
}

// Reativa o acesso. A publicação continua pausada: quem administra a conta retoma depois de conferir.
export async function reactivateAccount(id: string, actorId: string): Promise<void> {
  await inTransaction(async (q) => {
    const res = await q("update tenants set status = 'active', suspended_at = null, suspended_reason = null where id = $1 and status = 'suspended' returning id", [id]);
    if (res.rows.length === 0) await explainNoChange(q, id, 'active');
    await q(
      "insert into notifications (tenant_id, kind, level, title, body, link, audience) values ($1, 'account.reactivated', 'info', 'Conta reativada', 'O acesso voltou. A publicação continua pausada: confira os horários e retome em Configurações.', '/configuracoes', 'admin')",
      [id],
    );
    await recordAudit(q, { tenantId: id, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.account_reactivated', targetType: 'tenant', targetId: id });
  });
}

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

async function explainNoChange(q: Q, id: string, wanted: 'suspended' | 'active'): Promise<never> {
  const cur = await q('select status from tenants where id = $1', [id]);
  if (cur.rows.length === 0) throw new NotFoundError('Essa conta não existe mais. Volte para a lista.');
  throw new ConflictError(wanted === 'suspended' ? 'Essa conta já está suspensa.' : 'Essa conta não está suspensa.');
}

async function inTransaction<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client: DbClient = db();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  return client.transaction(async (tx) => fn(tx.query as unknown as Q));
}

export type CreatedAccount = { id: string; token: string; expiresAt: string };

// Cria a conta e o convite do primeiro administrador numa transação só. A conta nasce pausada (gatilho
// da 0013) e no plano do tipo (0017). O token inteiro volta UMA vez: o banco guarda só o hash.
export async function createAccountWithInvite(input: { name: string; kind: AccountKind; email: string }, actorId: string): Promise<CreatedAccount> {
  const token = newInviteToken();
  const hash = await hashInviteToken(token);
  for (const id of candidateIds(input.name)) {
    try {
      return await inTransaction(async (q) => {
        await q('insert into tenants (id, name, kind, plan_id) values ($1, $2, $3, $4)', [id, input.name, input.kind, PLAN_BY_KIND[input.kind]]);
        const invite = await q(
          `insert into invitations (tenant_id, email, role, token_hash, invited_by) values ($1, $2, 'admin', $3, $4) returning expires_at`,
          [id, input.email, hash, actorId],
        );
        await recordAudit(q, {
          tenantId: id,
          actorUserId: actorId,
          actorKind: 'platform_admin',
          action: 'console.account_created',
          targetType: 'tenant',
          targetId: id,
          metadata: { kind: input.kind },
        });
        return { id, token, expiresAt: iso(invite.rows[0].expires_at) ?? new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString() };
      });
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'tenants_pkey') continue;
      throw e;
    }
  }
  throw new UserError('Não achei um identificador livre para essa conta. Tente um nome um pouco diferente.');
}
