// Criação de conta contra o Postgres: conta, primeiro administrador e auditoria na mesma
// transação, plano do tipo certo, conta pausada e identificador que não repete (SPEC 011 R2).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { createAccount } = await import('../../platform/src/lib/accounts.ts');
const { db } = await import('../../platform/src/lib/db.ts');

const OWNER = '00000000-0000-4000-8000-0000000000a1';

async function cleanup() {
  const { rows } = await admin.query("select id from tenants where id like 'it-conta%'");
  await resetTenantData(admin, rows.map((r) => r.id));
  await admin.query('delete from users where id = $1', [OWNER]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query("insert into users (id, email) values ($1, 'it-dona@example.test')", [OWNER]);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
  await db().query('select 1').catch(() => {});
});

const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

describe('createAccount', () => {
  it('cria conta de empresa com o administrador, o plano inicial, publicação ligada e auditada', async () => {
    const id = await createAccount({ userId: OWNER, name: 'It Conta Doce Ponto', kind: 'empresa' });
    expect(id).toBe('it-conta-doce-ponto');
    expect(await one('select name, kind, plan_id, status from tenants where id = $1', [id])).toEqual({
      name: 'It Conta Doce Ponto', kind: 'empresa', plan_id: 'inicial', status: 'active',
    });
    expect(await one('select role from tenant_members where tenant_id = $1 and user_id = $2', [id, OWNER])).toEqual({ role: 'admin' });
    // Quem cria a própria conta começa com a publicação ligada (BEZ-361); o gatilho da 0013 pausa e a criação liga.
    expect(await one('select paused, reason, paused_at from publishing_controls where tenant_id = $1', [id])).toEqual({ paused: false, reason: null, paused_at: null });
    expect(await one("select actor_user_id, action, target_id, metadata from audit_events where tenant_id = $1", [id])).toEqual({
      actor_user_id: OWNER, action: 'account.created', target_id: id, metadata: { kind: 'empresa' },
    });
  });

  it('conta pessoa usa o plano pessoa', async () => {
    const id = await createAccount({ userId: OWNER, name: 'It Conta Marina', kind: 'pessoa' });
    expect(await one('select kind, plan_id from tenants where id = $1', [id])).toEqual({ kind: 'pessoa', plan_id: 'pessoa' });
  });

  it('o mesmo nome de novo ganha outro identificador, sem tocar na conta existente', async () => {
    const again = await createAccount({ userId: OWNER, name: 'It Conta Doce Ponto', kind: 'empresa' });
    expect(again).toMatch(/^it-conta-doce-ponto-[a-z0-9]{4}$/);
    const { rows } = await admin.query("select id from tenants where id like 'it-conta-doce-ponto%' order by id");
    expect(rows).toHaveLength(2);
  });

  it('se o administrador não pode ser gravado, nada da conta fica (transação desfeita)', async () => {
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    await expect(createAccount({ userId: ghost, name: 'It Conta Fantasma', kind: 'empresa' })).rejects.toMatchObject({ code: '23503' });
    expect(await one("select count(*)::int n from tenants where id like 'it-conta-fantasma%'")).toEqual({ n: 0 });
    expect(await one("select count(*)::int n from audit_events where tenant_id like 'it-conta-fantasma%'")).toEqual({ n: 0 });
    expect(await one("select count(*)::int n from publishing_controls where tenant_id like 'it-conta-fantasma%'")).toEqual({ n: 0 });
  });
});
