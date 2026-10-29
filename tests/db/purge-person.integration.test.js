// Apagar uma pessoa do banco (BEZ-433): o ensaio só conta, --apply apaga a pessoa e os convites para o
// e-mail dela, a auditoria fica, a outra pessoa e a conta não mudam, e quem administra a plataforma é
// recusada.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createPgDb, pgTypes } from '@ekoai/db';
import { resetTenantData } from './helpers.js';
import { run } from '../../scripts/purge-person.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');

const admin = new pg.Pool({ connectionString: url, max: 2 });
const db = createPgDb(new pg.Pool({ connectionString: url, max: 2, types: pgTypes(pg.types) }));

const TENANT = 'it-purge-a';
const HASH = (n) => String(n).padStart(64, '0');
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;

async function person(email, idp = `idp-${email}`) {
  return (await one('insert into users (email, idp_uid) values ($1, $2) returning id', [email, idp])).id;
}

async function clean() {
  await admin.query('delete from platform_admins');
  await resetTenantData(admin, [TENANT]);
}

beforeAll(async () => {
  await clean();
});
beforeEach(async () => {
  await clean();
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'Purge', 'empresa', 'inicial')", [TENANT]);
});
afterAll(async () => {
  await clean();
  await admin.end();
});

async function scenario() {
  const ana = await person('it-purge-ana@example.test');
  const bia = await person('it-purge-bia@example.test');
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'admin')", [TENANT, ana, bia]);
  // convite para a Ana (aceito) e um convite que a Ana enviou para outra pessoa
  await admin.query("insert into invitations (tenant_id, email, role, token_hash, invited_by, accepted_by, accepted_at) values ($1, 'it-purge-ana@example.test', 'viewer', $2, $3, $4, now())", [TENANT, HASH(1), bia, ana]);
  await admin.query("insert into invitations (tenant_id, email, role, token_hash, invited_by) values ($1, 'it-purge-nova@example.test', 'viewer', $2, $3)", [TENANT, HASH(2), ana]);
  await admin.query("insert into audit_events (tenant_id, actor_user_id, action) values ($1, $2, 'team.member_added')", [TENANT, ana]);
  return { ana, bia };
}

describe('purge-person', () => {
  it('o ensaio conta e não apaga nada', async () => {
    const { ana } = await scenario();
    const r = await run(db, { email: 'It-Purge-Ana@Example.Test' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain(ana);
    expect(r.message).toContain('idp-it-purge-ana@example.test');
    expect(r.message).toMatch(/tenant_members\.user_id: 1 \(cascade\)/);
    expect(r.message).toMatch(/invitations\.invited_by: 1 \(set null\)/);
    expect(r.message).toMatch(/convites para o e-mail: 1/);
    expect(r.message).toMatch(/audit_events com o id dela: 1/);
    expect(r.message).toMatch(/Ensaio: nada foi apagado/);
    expect(await count("select count(*)::int as n from users where email like 'it-purge-%'")).toBe(2);
    expect(await count('select count(*)::int as n from invitations where tenant_id = $1', [TENANT])).toBe(2);
  });

  it('--apply apaga a pessoa e os convites dela, mantém a auditoria e deixa a outra pessoa', async () => {
    const { ana, bia } = await scenario();
    const r = await run(db, { email: 'it-purge-ana@example.test', apply: true });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Apagada\. Conferido/);

    expect(await count("select count(*)::int as n from users where email = 'it-purge-ana@example.test'")).toBe(0);
    expect(await count('select count(*)::int as n from tenant_members where user_id = $1', [ana])).toBe(0);
    expect(await count("select count(*)::int as n from invitations where email = 'it-purge-ana@example.test'")).toBe(0);
    // o convite que ela enviou para outra pessoa fica, sem apontar para ela
    const sent = await one("select invited_by from invitations where email = 'it-purge-nova@example.test'");
    expect(sent.invited_by).toBeNull();
    // a outra pessoa e a conta não mudam
    expect(await count('select count(*)::int as n from tenant_members where user_id = $1', [bia])).toBe(1);
    expect(await count('select count(*)::int as n from tenants where id = $1', [TENANT])).toBe(1);
    // a auditoria de antes fica (é só de inserção) e a limpeza grava o próprio evento
    expect(await count('select count(*)::int as n from audit_events where actor_user_id = $1', [ana])).toBe(1);
    expect(await count("select count(*)::int as n from audit_events where action = 'person.purged' and target_id = $1", [String(ana)])).toBe(1);
  });

  it('repetir depois de apagada não encontra nada', async () => {
    await scenario();
    await run(db, { email: 'it-purge-ana@example.test', apply: true });
    const again = await run(db, { email: 'it-purge-ana@example.test', apply: true });
    expect(again.ok).toBe(true);
    expect(again.message).toMatch(/Nada a apagar/);
  });

  it('só convite, sem pessoa: --apply apaga o convite', async () => {
    await admin.query("insert into invitations (tenant_id, email, role, token_hash) values ($1, 'it-purge-so-convite@example.test', 'viewer', $2)", [TENANT, HASH(3)]);
    const dry = await run(db, { email: 'it-purge-so-convite@example.test' });
    expect(dry.message).toMatch(/só há convite/);
    const r = await run(db, { email: 'it-purge-so-convite@example.test', apply: true });
    expect(r.ok).toBe(true);
    expect(await count("select count(*)::int as n from invitations where email = 'it-purge-so-convite@example.test'")).toBe(0);
  });

  it('recusa a administradora da plataforma', async () => {
    const dono = await person('it-purge-dono@example.test');
    await admin.query('insert into platform_admins (user_id, email) values ($1, $2)', [dono, 'it-purge-dono@example.test']);
    const r = await run(db, { email: 'it-purge-dono@example.test', apply: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/administradora da plataforma/);
    expect(await count("select count(*)::int as n from users where email = 'it-purge-dono@example.test'")).toBe(1);
  });

  it('e-mail que não existe não é erro', async () => {
    const r = await run(db, { email: 'it-purge-ninguem@example.test', apply: true });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Nada a apagar/);
  });
});
