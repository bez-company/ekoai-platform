// team.ts: equipe e convites de uma conta (SPEC 011 R4). Tudo escopado pelo tenantDb: o tenant vem
// da sessão, nunca do corpo. Quem pode chamar (team.manage) é decidido na rota. Regras que o banco
// já garante (último administrador, limite de vagas, um convite pendente por pessoa) voltam daqui
// como mensagem para a tela, não como erro técnico.

import type { DbError } from '@ekoai/db';
import type { TenantDb } from './tenant-db';
import { UserError } from './errors';
import { personProfiles, userIdByEmail, type SessionUser } from './accounts';
import { auditTenant } from './audit';
import { INVITE_TTL_DAYS, hashInviteToken, inviteStatus, newInviteToken, type InviteStatus } from './invitation-model';
import type { Role } from './permissions';

export type TeamMember = { userId: string; email: string; name: string | null; role: Role; since: string };
export type TeamInvitation = { id: string; email: string; role: Role; status: InviteStatus; expiresAt: string; createdAt: string };

const LAST_ADMIN = 'A conta precisa de pelo menos um administrador. Promova outra pessoa antes.';
const PENDING_EXISTS = 'Já existe um convite pendente para esse e-mail. Reenvie ou cancele o atual.';
const SEATS_FULL = 'A conta chegou ao limite de pessoas do plano (equipe mais convites pendentes). Remova alguém, cancele um convite ou mude de plano.';

// Erros do banco que a pessoa entende e sabe resolver viram UserError; o resto sobe como técnico.
export function teamError(error: DbError): Error {
  if (error.code === '23505' && error.message.includes('invitations_pending_uidx')) return new UserError(PENDING_EXISTS);
  if (error.code === '23514' && error.hint === 'plan_seats') return new UserError(SEATS_FULL);
  if (error.code === '23514' && error.message.includes('pelo menos um administrador')) return new UserError(LAST_ADMIN);
  return new Error(error.message);
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export async function listTeam(t: TenantDb): Promise<{ members: TeamMember[]; invitations: TeamInvitation[] }> {
  const [m, inv] = await Promise.all([
    t.select('tenant_members', 'user_id,role,created_at').order('created_at', { ascending: true }),
    t
      .select('invitations', 'id,email,role,created_at,expires_at,accepted_at,cancelled_at')
      .is('accepted_at', null)
      .is('cancelled_at', null)
      .order('created_at', { ascending: false }),
  ]);
  if (m.error) throw new Error(`equipe: ${m.error.message}`);
  if (inv.error) throw new Error(`convites: ${inv.error.message}`);
  const profiles = await personProfiles((m.data ?? []).map((r) => String(r.user_id)));
  return {
    members: (m.data ?? []).map((r) => ({
      userId: String(r.user_id),
      email: profiles.get(String(r.user_id))?.email ?? '',
      name: profiles.get(String(r.user_id))?.name ?? null,
      role: r.role as Role,
      since: iso(r.created_at),
    })),
    invitations: (inv.data ?? []).map((r) => ({
      id: String(r.id),
      email: String(r.email),
      role: r.role as Role,
      status: inviteStatus({ expires_at: iso(r.expires_at) }),
      expiresAt: iso(r.expires_at),
      createdAt: iso(r.created_at),
    })),
  };
}

// Cria o convite e devolve o token inteiro UMA vez: ele vai no link e o banco guarda só o hash.
export async function createInvitation(t: TenantDb, actor: SessionUser, input: { email: string; role: Role }): Promise<{ id: string; token: string }> {
  const existing = await userIdByEmail(input.email);
  if (existing) {
    const member = await t.select('tenant_members', 'user_id').eq('user_id', existing).maybeSingle();
    if (member.error) throw new Error(`equipe: ${member.error.message}`);
    if (member.data) throw new UserError('Essa pessoa já faz parte da equipe.');
  }
  const token = newInviteToken();
  const created = await t
    .insert('invitations', { email: input.email, role: input.role, token_hash: await hashInviteToken(token), invited_by: actor.id })
    .select('id')
    .single();
  if (created.error) throw teamError(created.error);
  const id = String(created.data.id);
  await auditTenant(t, { actorUserId: actor.id, action: 'team.invitation_sent', targetType: 'invitation', targetId: id, metadata: { role: input.role } });
  return { id, token };
}

// Troca o token e a validade da mesma linha: o link antigo deixa de valer.
export async function resendInvitation(t: TenantDb, actor: SessionUser, id: string): Promise<{ id: string; email: string; role: Role; token: string }> {
  const token = newInviteToken();
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const res = await t
    .update('invitations', { token_hash: await hashInviteToken(token), expires_at: expires, invited_by: actor.id })
    .eq('id', id)
    .is('accepted_at', null)
    .is('cancelled_at', null)
    .select('id,email,role')
    .maybeSingle();
  if (res.error) throw teamError(res.error);
  if (!res.data) throw new UserError('Esse convite não está mais pendente. Crie um novo convite.');
  await auditTenant(t, { actorUserId: actor.id, action: 'team.invitation_resent', targetType: 'invitation', targetId: id });
  return { id, email: String(res.data.email), role: res.data.role as Role, token };
}

export async function cancelInvitation(t: TenantDb, actor: SessionUser, id: string): Promise<void> {
  const res = await t
    .update('invitations', { cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .is('accepted_at', null)
    .is('cancelled_at', null)
    .select('id')
    .maybeSingle();
  if (res.error) throw new Error(`cancelar convite: ${res.error.message}`);
  if (!res.data) throw new UserError('Esse convite já foi usado ou cancelado.');
  await auditTenant(t, { actorUserId: actor.id, action: 'team.invitation_cancelled', targetType: 'invitation', targetId: id });
}

async function currentRole(t: TenantDb, userId: string): Promise<Role> {
  const res = await t.select('tenant_members', 'role').eq('user_id', userId).maybeSingle();
  if (res.error) throw new Error(`equipe: ${res.error.message}`);
  if (!res.data) throw new UserError('Essa pessoa não faz parte da equipe.');
  return res.data.role as Role;
}

export async function changeRole(t: TenantDb, actor: SessionUser, userId: string, role: Role): Promise<void> {
  const from = await currentRole(t, userId);
  if (from === role) return;
  const res = await t.update('tenant_members', { role }).eq('user_id', userId);
  if (res.error) throw teamError(res.error);
  await auditTenant(t, { actorUserId: actor.id, action: 'team.role_changed', targetType: 'user', targetId: userId, metadata: { from, to: role } });
}

// Quem sai perde o acesso na próxima requisição: a sessão confere a membership no banco.
export async function removeMember(t: TenantDb, actor: SessionUser, userId: string): Promise<void> {
  const role = await currentRole(t, userId);
  const res = await t.delete('tenant_members').eq('user_id', userId);
  if (res.error) throw teamError(res.error);
  await auditTenant(t, { actorUserId: actor.id, action: 'team.member_removed', targetType: 'user', targetId: userId, metadata: { role } });
}
