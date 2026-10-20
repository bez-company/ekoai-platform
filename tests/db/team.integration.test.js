// Equipe, convites e aceite contra o Postgres (SPEC 011 R4): token só como hash, aceite atômico,
// limite de vagas, último administrador e a auditoria de cada ação.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const accounts = await import('../../platform/src/lib/accounts.ts');
const team = await import('../../platform/src/lib/team.ts');
const model = await import('../../platform/src/lib/invitation-model.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const TENANT = 'it-team';
const U = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const EMAIL = (n) => `it-pessoa${n}@example.test`;
const ANA = { id: U(1), name: 'Ana Ribeiro', sessionVersion: 1, lastTenantId: null };
const t = tenantDb(TENANT);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rejects = async (promise) => promise.then(() => null, (e) => e);

async function cleanup() {
  await resetTenantData(admin, [TENANT]);
}

beforeAll(async () => {
  await cleanup();
  for (let n = 1; n <= 8; n += 1) await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [U(n), EMAIL(n), n === 1 ? 'Ana Ribeiro' : null]);
  await admin.query('insert into tenants (id, name) values ($1, $2)', [TENANT, 'It Team']);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [TENANT, U(1)]);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('convite', () => {
  let invite;

  it('guarda só o hash do token e registra na auditoria sem o e-mail', async () => {
    invite = await team.createInvitation(t, ANA, { email: EMAIL(2), role: 'creator' });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await one('select token_hash, role, invited_by, expires_at > now() + interval \'6 days\' as week from invitations where id = $1', [invite.id]);
    expect(row).toMatchObject({ token_hash: await model.hashInviteToken(invite.token), role: 'creator', invited_by: U(1), week: true });
    expect(JSON.stringify(row)).not.toContain(invite.token);
    const audit = await one("select actor_user_id, metadata from audit_events where tenant_id = $1 and action = 'team.invitation_sent'", [TENANT]);
    expect(audit).toEqual({ actor_user_id: U(1), metadata: { role: 'creator' } });
    expect(JSON.stringify(audit)).not.toContain(EMAIL(2));
  });

  it('um pendente por e-mail, e quem já é da equipe não é convidado', async () => {
    const dup = await rejects(team.createInvitation(t, ANA, { email: EMAIL(2), role: 'viewer' }));
    expect(dup).toBeInstanceOf(UserError);
    expect(dup.message).toMatch(/convite pendente/);
    const member = await rejects(team.createInvitation(t, ANA, { email: EMAIL(1), role: 'viewer' }));
    expect(member).toBeInstanceOf(UserError);
    expect(member.message).toMatch(/já faz parte/);
  });

  it('a página do convite mostra conta, papel, e-mail e quem convidou, sem o e-mail de quem convidou', async () => {
    const preview = await accounts.previewInvitation(await model.hashInviteToken(invite.token));
    expect(preview).toEqual({ status: 'pending', accountName: 'It Team', role: 'creator', email: EMAIL(2), inviterName: 'Ana Ribeiro' });
    expect(await accounts.previewInvitation(await model.hashInviteToken(model.newInviteToken()))).toBeNull();
  });

  it('a lista de equipe traz pessoas e convites pendentes, sem hash', async () => {
    const list = await team.listTeam(t);
    expect(list.members).toEqual([expect.objectContaining({ userId: U(1), email: EMAIL(1), name: 'Ana Ribeiro', role: 'admin' })]);
    expect(list.invitations).toEqual([expect.objectContaining({ id: invite.id, email: EMAIL(2), role: 'creator', status: 'pending' })]);
    expect(JSON.stringify(list)).not.toContain('token_hash');
  });

  it('aceitar entra como o papel do convite, audita e não vale duas vezes', async () => {
    const hash = await model.hashInviteToken(invite.token);
    expect(await accounts.acceptInvitation(U(2), hash)).toBe(TENANT);
    expect(await one('select role from tenant_members where tenant_id = $1 and user_id = $2', [TENANT, U(2)])).toEqual({ role: 'creator' });
    expect(await one("select actor_user_id from audit_events where tenant_id = $1 and action = 'team.member_joined'", [TENANT])).toEqual({ actor_user_id: U(2) });
    const again = await rejects(accounts.acceptInvitation(U(2), hash));
    expect(model.acceptFailure(again.message)?.code).toBe('invite_used');
    expect((await accounts.previewInvitation(hash)).status).toBe('accepted');
  });

  it('o convite só serve para o e-mail convidado, e a falha não deixa membro nem auditoria', async () => {
    const other = await team.createInvitation(t, ANA, { email: EMAIL(3), role: 'viewer' });
    const hash = await model.hashInviteToken(other.token);
    const err = await rejects(accounts.acceptInvitation(U(4), hash));
    expect(model.acceptFailure(err.message)?.code).toBe('invite_email_mismatch');
    expect(await one('select count(*)::int n from tenant_members where tenant_id = $1', [TENANT])).toEqual({ n: 2 });
    expect(await one("select count(*)::int n from audit_events where tenant_id = $1 and action = 'team.member_joined'", [TENANT])).toEqual({ n: 1 });
    await team.cancelInvitation(t, ANA, other.id);
  });

  it('reenviar troca o token: o link antigo morre e o novo vale', async () => {
    const first = await team.createInvitation(t, ANA, { email: EMAIL(5), role: 'viewer' });
    const second = await team.resendInvitation(t, ANA, first.id);
    expect(second.token).not.toBe(first.token);
    const old = await rejects(accounts.acceptInvitation(U(5), await model.hashInviteToken(first.token)));
    expect(model.acceptFailure(old.message)?.code).toBe('invite_not_found');
    expect(await accounts.acceptInvitation(U(5), await model.hashInviteToken(second.token))).toBe(TENANT);
    await team.removeMember(t, ANA, U(5));
  });

  it('cancelado não aceita, e cancelar de novo é recusado com mensagem', async () => {
    const inv = await team.createInvitation(t, ANA, { email: EMAIL(6), role: 'viewer' });
    await team.cancelInvitation(t, ANA, inv.id);
    const err = await rejects(accounts.acceptInvitation(U(6), await model.hashInviteToken(inv.token)));
    expect(model.acceptFailure(err.message)?.code).toBe('invite_cancelled');
    const twice = await rejects(team.cancelInvitation(t, ANA, inv.id));
    expect(twice).toBeInstanceOf(UserError);
    const gone = await rejects(team.resendInvitation(t, ANA, inv.id));
    expect(gone).toBeInstanceOf(UserError);
  });

  it('vencido não aceita', async () => {
    const inv = await team.createInvitation(t, ANA, { email: EMAIL(7), role: 'viewer' });
    await admin.query("update invitations set expires_at = now() - interval '1 minute' where id = $1", [inv.id]);
    const err = await rejects(accounts.acceptInvitation(U(7), await model.hashInviteToken(inv.token)));
    expect(model.acceptFailure(err.message)?.code).toBe('invite_expired');
    expect((await accounts.previewInvitation(await model.hashInviteToken(inv.token))).status).toBe('expired');
    await team.cancelInvitation(t, ANA, inv.id);
  });
});

describe('equipe', () => {
  it('muda o papel, audita de-para e não faz nada se o papel é o mesmo', async () => {
    await team.changeRole(t, ANA, U(2), 'viewer');
    expect(await one('select role from tenant_members where tenant_id = $1 and user_id = $2', [TENANT, U(2)])).toEqual({ role: 'viewer' });
    expect(await one("select metadata from audit_events where tenant_id = $1 and action = 'team.role_changed'", [TENANT])).toEqual({ metadata: { from: 'creator', to: 'viewer' } });
    await team.changeRole(t, ANA, U(2), 'viewer');
    expect(await one("select count(*)::int n from audit_events where tenant_id = $1 and action = 'team.role_changed'", [TENANT])).toEqual({ n: 1 });
  });

  it('o último administrador não sai nem é rebaixado, com mensagem para a tela', async () => {
    for (const act of [() => team.changeRole(t, ANA, U(1), 'creator'), () => team.removeMember(t, ANA, U(1))]) {
      const err = await rejects(act());
      expect(err).toBeInstanceOf(UserError);
      expect(err.message).toMatch(/pelo menos um administrador/);
    }
    expect(await one('select role from tenant_members where tenant_id = $1 and user_id = $2', [TENANT, U(1)])).toEqual({ role: 'admin' });
  });

  it('pessoa fora da equipe: mensagem, sem mexer em nada', async () => {
    expect(await rejects(team.changeRole(t, ANA, U(8), 'viewer'))).toBeInstanceOf(UserError);
    expect(await rejects(team.removeMember(t, ANA, U(8)))).toBeInstanceOf(UserError);
  });

  it('remover tira a pessoa e audita com o papel que ela tinha', async () => {
    await team.removeMember(t, ANA, U(2));
    expect(await one('select count(*)::int n from tenant_members where tenant_id = $1 and user_id = $2', [TENANT, U(2)])).toEqual({ n: 0 });
    expect(await one("select metadata from audit_events where tenant_id = $1 and action = 'team.member_removed' order by created_at desc limit 1", [TENANT])).toEqual({ metadata: { role: 'viewer' } });
  });

  it('o plano limita equipe mais convites pendentes, com mensagem para a tela', async () => {
    for (const n of [2, 3, 4, 5]) await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'viewer')", [TENANT, U(n)]);
    const full = await rejects(team.createInvitation(t, ANA, { email: EMAIL(8), role: 'viewer' }));
    expect(full).toBeInstanceOf(UserError);
    expect(full.message).toMatch(/limite de pessoas/);
    await admin.query('delete from tenant_members where tenant_id = $1 and user_id = $2', [TENANT, U(5)]);
    const inv = await team.createInvitation(t, ANA, { email: EMAIL(8), role: 'viewer' });
    const blocked = await rejects(team.createInvitation(t, ANA, { email: 'it-extra@example.test', role: 'viewer' }));
    expect(blocked).toBeInstanceOf(UserError);
    await team.cancelInvitation(t, ANA, inv.id);
  });
});

describe('nome da pessoa no login', () => {
  const id = (over = {}) => ({ uid: 'idp-it-nome', email: 'it-nome@example.test', emailVerified: true, authTime: 0, secondFactor: null, name: 'Marina Lopes', ...over });

  it('entra uma vez, no primeiro login, e o login seguinte não sobrescreve', async () => {
    const first = await accounts.findOrLinkUser(id());
    expect(first.name).toBe('Marina Lopes');
    const second = await accounts.findOrLinkUser(id({ name: 'Outro Nome' }));
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Marina Lopes');
    expect(await one("select name from users where email = 'it-nome@example.test'")).toEqual({ name: 'Marina Lopes' });
  });

  it('quem foi criado por convite (só e-mail) recebe o nome ao ligar', async () => {
    await admin.query("insert into users (email) values ('it-convidada@example.test')");
    const user = await accounts.findOrLinkUser(id({ uid: 'idp-it-conv', email: 'it-convidada@example.test', name: 'Carla Mendes' }));
    expect(user.name).toBe('Carla Mendes');
  });

  it('sem nome no token, fica sem nome', async () => {
    const user = await accounts.findOrLinkUser(id({ uid: 'idp-it-sem', email: 'it-sem@example.test', name: null }));
    expect(user.name).toBeNull();
  });
});
