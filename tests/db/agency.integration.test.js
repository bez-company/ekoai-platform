// A agência contra o Postgres (SPEC 039, BEZ-265): o console liga o plano, a agência cadastra clientes sem limite, os
// administradores dela entram em cada cliente, cada cliente conecta o próprio Instagram e o banco segura as regras.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { agencyContext, createClient, listClients, switchableAccounts } = await import('../../platform/src/lib/agency.ts');
const { setAgencyOnAccount, listAgencyRequests, consoleAgencyOf } = await import('../../platform/src/lib/console-agency.ts');
const { requestAgency } = await import('../../platform/src/lib/account-plan.ts');
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');

const AG = 'it-agency-bez';
const OTHER = 'it-agency-other';
const ANA = { id: '00000000-0000-4000-8000-000000000a71', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const BIA = { id: '00000000-0000-4000-8000-000000000a72', name: 'Bia', sessionVersion: 1, lastTenantId: null };
const CAIO = { id: '00000000-0000-4000-8000-000000000a73', name: 'Caio', sessionVersion: 1, lastTenantId: null };
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const clientIds = async () => (await admin.query('select id from tenants where agency_id = any($1)', [[AG, OTHER]])).rows.map((r) => r.id);

async function cleanup() {
  await resetTenantData(admin, [...(await clientIds()), AG, OTHER]);
  await admin.query('delete from users where id = any($1)', [[ANA.id, BIA.id, CAIO.id]]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query(
    "insert into users (id, email, name) values ($1, 'it-ag-ana@example.test', 'Ana'), ($2, 'it-ag-bia@example.test', 'Bia'), ($3, 'it-ag-caio@example.test', 'Caio')",
    [ANA.id, BIA.id, CAIO.id],
  );
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'BEZ Teste', 'empresa', 'inicial'), ($2, 'Outra', 'empresa', 'inicial')", [AG, OTHER]);
  // Ana e Bia administram a agência; Caio cria posts nela (não entra nos clientes).
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'admin'), ($1, $4, 'creator')", [AG, ANA.id, BIA.id, CAIO.id]);
});

afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('agência', () => {
  it('o pedido de Agência aparece no console', async () => {
    await requestAgency(tenantDb(AG), ANA, { brands: 8, note: 'Vários clientes' });
    const r = (await listAgencyRequests()).find((x) => x.tenantId === AG);
    expect(r).toMatchObject({ name: 'BEZ Teste', brands: 8, note: 'Vários clientes', isAgency: false });
  });

  it('conta comum não cadastra cliente', async () => {
    await expect(createClient(AG, ANA, 'Antes')).rejects.toThrow(/não é uma agência/);
  });

  it('o console liga o plano, avisa a conta e audita', async () => {
    await setAgencyOnAccount(AG, ANA.id, true);
    expect(await one('select plan_id from tenants where id = $1', [AG])).toEqual({ plan_id: 'agencia' });
    expect(await agencyContext(AG)).toEqual({ isAgency: true, agency: null });
    expect(await one("select actor_kind from audit_events where tenant_id = $1 and action = 'console.agency_enabled'", [AG])).toEqual({ actor_kind: 'platform_admin' });
    expect((await one("select link from notifications where tenant_id = $1 and title = 'A conta agora é Agência'", [AG])).link).toBe('/clientes');
    expect((await listAgencyRequests()).find((x) => x.tenantId === AG).isAgency).toBe(true);
    await expect(setAgencyOnAccount(AG, ANA.id, true)).rejects.toThrow(/já é agência/);
  });

  it('cadastra clientes sem limite e os administradores da agência entram em todos', async () => {
    const ids = [];
    for (let i = 1; i <= 7; i++) ids.push(await createClient(AG, ANA, `Cliente ${i}`));
    expect(new Set(ids).size).toBe(7);
    const c = await one('select kind, plan_id, agency_id from tenants where id = $1', [ids[0]]);
    expect(c).toEqual({ kind: 'empresa', plan_id: 'inicial', agency_id: AG });
    const members = (await admin.query('select user_id, role from tenant_members where tenant_id = $1 order by user_id', [ids[0]])).rows;
    expect(members).toEqual([
      { user_id: ANA.id, role: 'admin' },
      { user_id: BIA.id, role: 'admin' },
    ]);
    expect(await one("select count(*)::int as n from audit_events where tenant_id = $1 and action = 'agency.client_created'", [AG])).toEqual({ n: 7 });
    expect(await agencyContext(ids[0])).toEqual({ isAgency: false, agency: { id: AG, name: 'BEZ Teste' } });
    // a publicação do cliente nasce ligada, como na conta que a pessoa cria
    expect(await one('select paused from publishing_controls where tenant_id = $1', [ids[0]])).toEqual({ paused: false });
  });

  it('cada cliente conecta o próprio Instagram e a lista mostra cada um', async () => {
    const [first, second] = (await listClients(AG, ANA.id)).map((c) => c.id);
    await admin.query(
      "insert into social_accounts (tenant_id, channel, external_id, handle, status) values ($1, 'instagram', 'it-ig-1', 'cliente_um', 'active'), ($2, 'instagram', 'it-ig-2', 'cliente_dois', 'reauth_required')",
      [first, second],
    );
    const rows = await listClients(AG, ANA.id);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ name: 'Cliente 1', member: true, instagram: { handle: 'cliente_um', status: 'active' } });
    expect(rows[1].instagram).toEqual({ handle: 'cliente_dois', status: 'reauth_required' });
    expect(rows[2].instagram).toBeNull();
    expect((await listClients(AG, CAIO.id))[0].member).toBe(false);
    // o mesmo Instagram não entra em dois clientes
    await expect(admin.query("insert into social_accounts (tenant_id, channel, external_id, status) values ($1, 'instagram', 'it-ig-1', 'active')", [rows[2].id])).rejects.toThrow(/duplicate key/);
    const agency = await consoleAgencyOf(AG);
    expect(agency.clients).toHaveLength(7);
    expect(agency.clients[0]).toEqual({ id: rows[0].id, name: 'Cliente 1', instagram: 'cliente_um' });
  });

  it('o seletor da pessoa traz a agência e os clientes; quem só cria na agência vê só a agência', async () => {
    const ana = await switchableAccounts(ANA.id);
    expect(ana).toHaveLength(8);
    expect(ana.find((a) => a.id === AG)).toEqual({ id: AG, name: 'BEZ Teste', agencyId: null, isAgency: true });
    expect(await switchableAccounts(CAIO.id)).toEqual([{ id: AG, name: 'BEZ Teste', agencyId: null, isAgency: true }]);
  });

  it('o banco segura as regras: cliente só de agência, sem aninhar e sem sair do plano com clientes', async () => {
    await expect(admin.query('update tenants set agency_id = $1 where id = $1', [OTHER])).rejects.toThrow();
    await expect(admin.query('update tenants set agency_id = $2 where id = $1', [OTHER, (await listClients(AG, ANA.id))[0].id])).rejects.toThrow(/não é uma agência/);
    await expect(admin.query('update tenants set agency_id = $2 where id = $1', [AG, AG])).rejects.toThrow();
    await expect(setAgencyOnAccount(AG, ANA.id, false)).rejects.toThrow(/ainda tem clientes/);
    await expect(admin.query("update tenants set plan_id = 'inicial' where id = $1", [AG])).rejects.toThrow(/tem clientes/);
  });

  it('sem clientes, a agência volta ao Time', async () => {
    await resetTenantData(admin, await clientIds());
    await setAgencyOnAccount(AG, ANA.id, false);
    expect(await one('select plan_id from tenants where id = $1', [AG])).toEqual({ plan_id: 'inicial' });
  });
});
