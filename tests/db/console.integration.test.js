// Console do administrador da plataforma contra o Postgres (BEZ-303, SPEC 011 R9): lista com busca,
// criar conta com convite, suspender e reativar, e o que a suspensão tranca de verdade (entrar, publicar
// e gerar), sempre com o registro de auditoria.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const accounts = await import('../../platform/src/lib/accounts.ts');
const consoleAccounts = await import('../../platform/src/lib/console-accounts.ts');
const worker = await import('../../platform/src/lib/generation-worker.ts');
const model = await import('../../platform/src/lib/invitation-model.ts');
const { ConflictError, NotFoundError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-console-a';
const B = 'it-console-b';
const OWNER = '00000000-0000-4000-8000-000000000301';
const PERSON = '00000000-0000-4000-8000-000000000302';
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const created = [];

async function cleanup() {
  await resetTenantData(admin, [A, B, ...created]);
  await admin.query("delete from audit_events where actor_kind = 'platform_admin'");
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into users (id, email, name) values ($1, $2, $3), ($4, $5, $6)', [OWNER, 'it-dono@example.test', 'Dono', PERSON, 'it-ana-console@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Console A 100%', B, 'It Console B']);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [A, PERSON]);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('lista', () => {
  it('traz status, pessoas e plano, e uma conta nova nasce pausada', async () => {
    const { rows } = await consoleAccounts.listAccounts({ search: 'It Console', status: 'all' });
    const a = rows.find((r) => r.id === A);
    expect(a).toMatchObject({ name: 'It Console A 100%', kind: 'empresa', people: 1, status: 'paused', instagram: null });
    expect(a.planName).toBeTruthy();
  });

  it('busca por e-mail de quem é da conta e trata % como texto', async () => {
    expect((await consoleAccounts.listAccounts({ search: 'it-ana-console', status: 'all' })).rows.map((r) => r.id)).toEqual([A]);
    expect((await consoleAccounts.listAccounts({ search: '100%', status: 'all' })).rows.map((r) => r.id)).toEqual([A]);
    expect((await consoleAccounts.listAccounts({ search: '%', status: 'all' })).rows.map((r) => r.id)).toEqual([A]);
  });

  it('filtra por status e conta as ativas', async () => {
    await admin.query('insert into publishing_controls (tenant_id, paused) values ($1, false) on conflict (tenant_id) do update set paused = false', [B]);
    const active = await consoleAccounts.listAccounts({ search: 'It Console', status: 'active' });
    expect(active.rows.map((r) => r.id)).toEqual([B]);
    const all = await consoleAccounts.listAccounts({ search: 'It Console', status: 'all' });
    expect(all.total).toBe(2);
    expect(all.active).toBe(1);
    expect((await consoleAccounts.listAccounts({ search: 'It Console', status: 'suspended' })).rows).toEqual([]);
  });
});

describe('criar conta com convite', () => {
  it('cria a conta no plano do tipo, o convite de administrador só com o hash e a auditoria', async () => {
    const r = await consoleAccounts.createAccountWithInvite({ name: 'It Console Nova', kind: 'pessoa', email: 'it-primeira@example.test' }, OWNER);
    created.push(r.id);
    expect(r.id).toBe('it-console-nova');
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const t = await one('select kind, plan_id, status from tenants where id = $1', [r.id]);
    expect(t).toEqual({ kind: 'pessoa', plan_id: 'pessoa', status: 'active' });
    const inv = await one('select email, role, token_hash, invited_by, expires_at > now() + interval \'6 days\' as week from invitations where tenant_id = $1', [r.id]);
    expect(inv).toMatchObject({ email: 'it-primeira@example.test', role: 'admin', token_hash: await model.hashInviteToken(r.token), invited_by: OWNER, week: true });
    const audit = await one("select actor_kind, actor_user_id, metadata from audit_events where tenant_id = $1 and action = 'console.account_created'", [r.id]);
    expect(audit).toMatchObject({ actor_kind: 'platform_admin', actor_user_id: OWNER, metadata: { kind: 'pessoa' } });
    expect(JSON.stringify(audit)).not.toContain('it-primeira');
    const paused = await one('select paused from publishing_controls where tenant_id = $1', [r.id]);
    expect(paused.paused).toBe(true);
  });

  it('nome repetido ganha sufixo e nada fica pela metade', async () => {
    const r = await consoleAccounts.createAccountWithInvite({ name: 'It Console Nova', kind: 'empresa', email: 'it-segunda@example.test' }, OWNER);
    created.push(r.id);
    expect(r.id).toMatch(/^it-console-nova-[0-9a-z]{4}$/);
    expect((await one('select count(*)::int as n from invitations where tenant_id = $1', [r.id])).n).toBe(1);
  });

  it('o convite do console é aceito como qualquer outro e a pessoa vira administradora', async () => {
    const r = await consoleAccounts.createAccountWithInvite({ name: 'It Console Aceite', kind: 'empresa', email: 'it-aceite@example.test' }, OWNER);
    created.push(r.id);
    await admin.query('insert into users (id, email) values ($1, $2)', ['00000000-0000-4000-8000-000000000303', 'it-aceite@example.test']);
    const tenantId = await accounts.acceptInvitation('00000000-0000-4000-8000-000000000303', await model.hashInviteToken(r.token));
    expect(tenantId).toBe(r.id);
    expect((await one('select role from tenant_members where tenant_id = $1', [r.id])).role).toBe('admin');
  });
});

describe('suspender e reativar', () => {
  it('suspender grava motivo e quando, pausa a publicação e audita sem o texto solto', async () => {
    await consoleAccounts.suspendAccount(A, OWNER, 'Pagamento em atraso');
    const t = await one('select status, suspended_reason, suspended_at is not null as at from tenants where id = $1', [A]);
    expect(t).toEqual({ status: 'suspended', suspended_reason: 'Pagamento em atraso', at: true });
    expect((await one('select paused, reason from publishing_controls where tenant_id = $1', [A]))).toEqual({ paused: true, reason: 'Conta suspensa' });
    const audit = await one("select actor_kind, metadata from audit_events where tenant_id = $1 and action = 'console.account_suspended'", [A]);
    expect(audit).toMatchObject({ actor_kind: 'platform_admin', metadata: { reason: 'Pagamento em atraso' } });
    const detail = await consoleAccounts.getAccount(A);
    expect(detail).toMatchObject({ suspended: true, status: 'suspended', suspendedReason: 'Pagamento em atraso' });
  });

  it('suspender duas vezes e reativar quem não está suspensa voltam conflito; conta que não existe, não achada', async () => {
    await expect(consoleAccounts.suspendAccount(A, OWNER, 'de novo')).rejects.toBeInstanceOf(ConflictError);
    await expect(consoleAccounts.reactivateAccount(B, OWNER)).rejects.toBeInstanceOf(ConflictError);
    await expect(consoleAccounts.suspendAccount('it-nao-existe', OWNER, 'sem conta')).rejects.toBeInstanceOf(NotFoundError);
    expect((await one("select count(*)::int as n from audit_events where tenant_id = $1 and action = 'console.account_suspended'", [A])).n).toBe(1);
  });

  it('tranca o acesso: sem papel na conta e a lista de contas da pessoa marca como suspensa', async () => {
    expect(await accounts.roleIn(PERSON, A)).toBeNull();
    expect(await accounts.membershipsOf(PERSON)).toEqual([expect.objectContaining({ tenantId: A, role: 'admin', suspended: true })]);
  });

  it('tranca a publicação (mesmo despausada) e a fila de geração', async () => {
    await admin.query('update publishing_controls set paused = false where tenant_id = $1', [A]);
    await admin.query("insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, status) values ($1, 'instagram', '{}', 'x', now() - interval '1 hour', 'scheduled')", [A]);
    await admin.query('insert into publishing_controls (tenant_id, paused) values ($1, false) on conflict (tenant_id) do update set paused = false', [B]);
    await admin.query("insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, status) values ($1, 'instagram', '{}', 'y', now() - interval '1 hour', 'scheduled')", [B]);
    const due = (await admin.query('select tenant_id from app.due_scheduled_posts(now(), 50)')).rows.map((r) => r.tenant_id);
    expect(due).toContain(B);
    expect(due).not.toContain(A);

    await admin.query("insert into briefs (tenant_id, pillar, idea, status, goal, source) values ($1, 'ensinar', 'a', 'queued', 'ensinar', 'platform'), ($2, 'ensinar', 'b', 'queued', 'ensinar', 'platform')", [A, B]);
    const claimed = (await worker.claimQueued(10)).map((c) => c.tenant_id);
    expect(claimed).toContain(B);
    expect(claimed).not.toContain(A);
  });

  it('reativar devolve o acesso, deixa a publicação pausada, avisa os administradores e audita', async () => {
    await admin.query('update publishing_controls set paused = true where tenant_id = $1', [A]);
    await consoleAccounts.reactivateAccount(A, OWNER);
    expect(await one('select status, suspended_at, suspended_reason from tenants where id = $1', [A])).toEqual({ status: 'active', suspended_at: null, suspended_reason: null });
    expect(await accounts.roleIn(PERSON, A)).toBe('admin');
    expect((await one('select paused from publishing_controls where tenant_id = $1', [A])).paused).toBe(true);
    expect(await one("select audience, link from notifications where tenant_id = $1 and kind = 'account.reactivated'", [A])).toEqual({ audience: 'admin', link: '/configuracoes' });
    expect((await one("select count(*)::int as n from audit_events where tenant_id = $1 and action = 'console.account_reactivated'", [A])).n).toBe(1);
  });
});

describe('detalhe', () => {
  it('reúne pessoas, convites pendentes (contam como vaga) e uso do mês', async () => {
    await admin.query("insert into invitations (tenant_id, email, role, token_hash) values ($1, 'it-carla@example.test', 'viewer', $2)", [A, 'a'.repeat(64)]);
    const d = await consoleAccounts.getAccount(A);
    expect(d.people).toEqual([expect.objectContaining({ email: 'it-ana-console@example.test', role: 'admin' })]);
    expect(d.invitations).toEqual([expect.objectContaining({ email: 'it-carla@example.test', role: 'viewer', status: 'pending' })]);
    expect(d.usage).toMatchObject({ seats: 2, instagram: 0, postsPublished: 0, generations: 0 });
    expect(d.plan.maxSeats).toBeGreaterThan(0);
    expect(await consoleAccounts.getAccount('it-nao-existe')).toBeNull();
  });
});
