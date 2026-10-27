// Upgrade de Individual para Time contra o Postgres (SPEC 025, BEZ-376): troca tipo e plano juntos (o gatilho exige plano do mesmo tipo),
// não apaga nada, não vale duas vezes e o pedido da Agência fica na auditoria da conta.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { upgradeToTime, requestAgency } = await import('../../platform/src/lib/account-plan.ts');

const SOLO = 'it-plan-solo';
const CO = 'it-plan-co';
const ANA = { id: '00000000-0000-4000-8000-000000000a51', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

beforeAll(async () => {
  await resetTenantData(admin, [SOLO, CO]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-plan-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'Solo', 'pessoa', 'pessoa'), ($2, 'Co', 'empresa', 'inicial')", [SOLO, CO]);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $3, 'admin'), ($2, $3, 'admin')", [SOLO, CO, ANA.id]);
});

afterAll(async () => {
  await resetTenantData(admin, [SOLO, CO]);
  await admin.query('delete from users where id = $1', [ANA.id]);
  await admin.end();
});

describe('upgrade para Time', () => {
  it('troca o tipo e o plano, avisa o administrador e audita', async () => {
    await upgradeToTime(tenantDb(SOLO), ANA);
    expect(await one('select kind, plan_id from tenants where id = $1', [SOLO])).toEqual({ kind: 'empresa', plan_id: 'inicial' });
    expect(await one("select actor_user_id, metadata from audit_events where tenant_id = $1 and action = 'plan.upgraded'", [SOLO])).toEqual({ actor_user_id: ANA.id, metadata: { from: 'individual', to: 'time' } });
    expect((await one("select audience from notifications where tenant_id = $1 and kind = 'account.plan_changed'", [SOLO])).audience).toBe('admin');
    // a pessoa continua administradora e a conta segue a mesma
    expect(await one('select role from tenant_members where tenant_id = $1 and user_id = $2', [SOLO, ANA.id])).toEqual({ role: 'admin' });
  });

  it('não vale duas vezes nem em conta que já é de equipe, e não mexe em outra conta', async () => {
    await expect(upgradeToTime(tenantDb(SOLO), ANA)).rejects.toThrow(/já é de equipe/);
    await expect(upgradeToTime(tenantDb(CO), ANA)).rejects.toThrow(/já é de equipe/);
    expect((await one('select count(*)::int as n from audit_events where tenant_id = $1 and action = $2', [CO, 'plan.upgraded'])).n).toBe(0);
  });
});

describe('pedido da Agência', () => {
  it('fica na auditoria da conta, com as marcas e o recado, e não muda o plano', async () => {
    await requestAgency(tenantDb(CO), ANA, { brands: 5, note: 'Somos uma agência' });
    expect(await one("select metadata from audit_events where tenant_id = $1 and action = 'plan.agency_requested'", [CO])).toEqual({ metadata: { brands: 5, note: 'Somos uma agência' } });
    expect(await one('select kind, plan_id from tenants where id = $1', [CO])).toEqual({ kind: 'empresa', plan_id: 'inicial' });
  });
});
