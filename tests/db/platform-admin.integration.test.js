// O administrador da plataforma (ultra admin): uma linha só, gravada por operação de sistema.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createPgDb, pgTypes } from '@ekoai/db';
import { resetTenantData } from './helpers.js';
import { run, validate } from '../../scripts/platform-admin.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');

const admin = new pg.Pool({ connectionString: url, max: 2 });
const db = createPgDb(new pg.Pool({ connectionString: url, max: 2, types: pgTypes(pg.types) }));

async function person(email, idp = 'idp-' + email) {
  const { rows } = await admin.query('insert into users (email, idp_uid) values ($1, $2) returning id', [email, idp]);
  return rows[0].id;
}
const holder = async () => (await admin.query('select user_id from platform_admins')).rows;

beforeAll(async () => {
  await resetTenantData(admin);
  await admin.query("delete from platform_admins");
});
beforeEach(async () => {
  await admin.query('delete from platform_admins');
  await admin.query("delete from users where email like 'it-%@example.test'");
});
afterAll(async () => {
  await admin.query('delete from platform_admins');
  await admin.query("delete from users where email like 'it-%@example.test'");
  await admin.end();
});

describe('validação', () => {
  it('pede um e-mail completo', () => {
    expect(validate({})).toMatch(/--email/);
    expect(validate({ email: 'sem-arroba' })).toMatch(/--email/);
    expect(validate({ email: 'a@b.co' })).toBeNull();
  });
});

describe('platform-admin', () => {
  it('sem --grant só confere e não grava nada', async () => {
    const id = await person('it-dono@example.test');
    const r = await run(db, { email: 'It-Dono@Example.Test' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain(id);
    expect(r.message).toContain('ninguém ainda');
    expect(await holder()).toEqual([]);
  });

  it('pessoa inexistente ou que nunca entrou é recusada', async () => {
    expect((await run(db, { email: 'it-ninguem@example.test', grant: true })).message).toMatch(/não encontrada/);
    await admin.query("insert into users (email) values ('it-convidada@example.test')");
    const r = await run(db, { email: 'it-convidada@example.test', grant: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ainda não entrou/);
    expect(await holder()).toEqual([]);
  });

  it('grava a administradora, registra a auditoria e é idempotente', async () => {
    const id = await person('it-dono@example.test');
    const first = await run(db, { email: 'it-dono@example.test', grant: true });
    expect(first.ok).toBe(true);
    expect(await holder()).toEqual([{ user_id: id }]);
    const events = (await admin.query("select actor_kind, action, target_id from audit_events where action = 'platform_admin.granted' and target_id = $1", [id])).rows;
    expect(events).toEqual([{ actor_kind: 'system', action: 'platform_admin.granted', target_id: id }]);

    const again = await run(db, { email: 'it-dono@example.test', grant: true });
    expect(again.ok).toBe(true);
    expect(again.message).toMatch(/Já é a administradora/);
    expect(await holder()).toHaveLength(1);
  });

  it('só uma pessoa: outra é recusada até a primeira ser removida', async () => {
    const a = await person('it-a@example.test');
    const b = await person('it-b@example.test');
    await run(db, { email: 'it-a@example.test', grant: true });
    const denied = await run(db, { email: 'it-b@example.test', grant: true });
    expect(denied.ok).toBe(false);
    expect(denied.message).toMatch(/Outra pessoa já é a administradora/);
    expect(await holder()).toEqual([{ user_id: a }]);

    expect((await run(db, { email: 'it-b@example.test', revoke: true })).ok).toBe(false);
    expect((await run(db, { email: 'it-a@example.test', revoke: true })).ok).toBe(true);
    expect(await holder()).toEqual([]);
    expect((await run(db, { email: 'it-b@example.test', grant: true })).ok).toBe(true);
    expect(await holder()).toEqual([{ user_id: b }]);
  });

  it('o banco recusa uma segunda linha mesmo por SQL direto', async () => {
    const a = await person('it-a@example.test');
    const b = await person('it-b@example.test');
    await admin.query("insert into platform_admins (user_id, email) values ($1, 'it-a@example.test')", [a]);
    await expect(admin.query("insert into platform_admins (user_id, email) values ($1, 'it-b@example.test')", [b])).rejects.toThrow();
  });

  it('--grant e --revoke juntos são recusados', async () => {
    await person('it-dono@example.test');
    expect((await run(db, { email: 'it-dono@example.test', grant: true, revoke: true })).ok).toBe(false);
  });
});
