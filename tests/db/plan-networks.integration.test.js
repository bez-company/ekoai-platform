// Limite de redes por plano contra o Postgres (SPEC 021, BEZ-494, migration 0059): o plano de 1 rede recusa a segunda rede, o de
// 3 redes e o Time aceitam as três, reconectar o que já está conectado nunca é recusado e a conta que já passava do limite
// (conectou antes da regra) não perde nada: só a rede nova, depois de desconectar, é que fica barrada.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const social = await import('../../platform/src/lib/social-accounts.ts');
const { ConnectError } = await import('../../platform/src/lib/linkedin-oauth-model.ts');

const ONE = 'it-net-one';
const THREE = 'it-net-three';
const TEAM = 'it-net-team';
const OLD = 'it-net-old';
const ALL = [ONE, THREE, TEAM, OLD];
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rejects = async (promise) => promise.then(() => null, (e) => e);

const box = {
  seal: async (plain, ctx) => ({ ciphertext: Buffer.from(`${ctx}|${plain}`).toString('base64'), keyVersion: 'projects/p/keyRings/k/cryptoKeys/social-tokens/cryptoKeyVersions/1' }),
  open: async ({ ciphertext }, ctx) => Buffer.from(ciphertext, 'base64').toString().split('|').slice(1).join('|'),
};
const linkedin = (memberId) => ({
  accessToken: 'AQX-token',
  refreshToken: null,
  expiresAt: new Date(Date.now() + 60 * 86_400_000),
  scopes: ['openid', 'profile', 'w_member_social'],
  profile: { memberId, name: 'Ana' },
});

const addAccount = (tenant, channel, externalId, status = 'active') =>
  admin.query('insert into social_accounts (tenant_id, channel, external_id, status) values ($1, $2, $3, $4)', [tenant, channel, externalId, status]);
const failure = async (promise) => {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
};

beforeAll(async () => {
  await resetTenantData(admin, ALL);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'pessoa', 'pessoa'), ($2, $2, 'pessoa', 'pessoa-3'), ($3, $3, 'empresa', 'inicial'), ($4, $4, 'empresa', 'inicial')", [ONE, THREE, TEAM, OLD]);
});
afterAll(async () => {
  await resetTenantData(admin, ALL);
  await admin.end();
});

describe('planos e redes do banco', () => {
  it('o Individual de 1 rede permite 1, o de 3 redes e o Time permitem 3', async () => {
    const { rows } = await admin.query("select id, max_networks from plans where id in ('pessoa', 'pessoa-3', 'inicial') order by id");
    expect(Object.fromEntries(rows.map((r) => [r.id, r.max_networks]))).toEqual({ inicial: 3, pessoa: 1, 'pessoa-3': 3 });
  });
});

describe('plano de 1 rede', () => {
  it('conecta a primeira rede e recusa a segunda, com o erro que a tela entende e sem deixar linha nem token', async () => {
    await addAccount(ONE, 'instagram', 'ig-one');
    const err = await rejects(social.saveLinkedInConnection(tenantDb(ONE), { userId: null, connected: linkedin('mem-one') }, box));
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.flash).toBe('networks');
    expect(err.message).toMatch(/não inclui mais redes/);
    expect((await one("select count(*)::int as n from social_accounts where tenant_id = $1 and channel = 'linkedin'", [ONE])).n).toBe(0);
    expect((await one('select count(*)::int as n from social_account_secrets s join social_accounts a on a.id = s.social_account_id where a.tenant_id = $1', [ONE])).n).toBe(0);
  });

  it('o banco recusa a inserção direta com a dica de limite de redes', async () => {
    const err = await failure(addAccount(ONE, 'twitter', 'x-one'));
    expect(err).toMatchObject({ code: '23514', hint: 'plan_networks' });
  });

  it('reconectar a rede que já está conectada continua permitido', async () => {
    await admin.query("update social_accounts set status = 'reauth_required' where tenant_id = $1", [ONE]);
    await admin.query("update social_accounts set status = 'active' where tenant_id = $1", [ONE]);
    expect((await one("select status from social_accounts where tenant_id = $1 and channel = 'instagram'", [ONE])).status).toBe('active');
  });

  it('desconectar libera a vaga para outra rede', async () => {
    await admin.query("update social_accounts set status = 'revoked' where tenant_id = $1", [ONE]);
    const saved = await social.saveLinkedInConnection(tenantDb(ONE), { userId: null, connected: linkedin('mem-one-2') }, box);
    expect(saved.id).toBeTruthy();
  });
});

describe('plano de 3 redes e Time', () => {
  it('o Individual de 3 redes conecta as três redes', async () => {
    await addAccount(THREE, 'instagram', 'ig-three');
    await addAccount(THREE, 'linkedin', 'li-three');
    await addAccount(THREE, 'twitter', 'x-three');
    expect((await one("select count(distinct channel)::int as n from social_accounts where tenant_id = $1 and status <> 'revoked'", [THREE])).n).toBe(3);
  });

  it('o Time conecta as três redes', async () => {
    await addAccount(TEAM, 'instagram', 'ig-team');
    await addAccount(TEAM, 'linkedin', 'li-team');
    await addAccount(TEAM, 'twitter', 'x-team');
    expect((await one("select count(distinct channel)::int as n from social_accounts where tenant_id = $1 and status <> 'revoked'", [TEAM])).n).toBe(3);
  });
});

describe('conta que já passava do limite', () => {
  it('não perde a conexão que tinha: só a rede nova, depois de desconectar, fica barrada', async () => {
    await addAccount(OLD, 'instagram', 'ig-old');
    await addAccount(OLD, 'linkedin', 'li-old');
    await admin.query("update tenants set kind = 'pessoa', plan_id = 'pessoa' where id = $1", [OLD]);
    // pedir reconexão e reconectar o LinkedIn que já existia segue permitido, mesmo com 2 redes num plano de 1
    await admin.query("update social_accounts set status = 'reauth_required' where tenant_id = $1 and channel = 'linkedin'", [OLD]);
    await admin.query("update social_accounts set status = 'active' where tenant_id = $1 and channel = 'linkedin'", [OLD]);
    expect((await one("select count(*)::int as n from social_accounts where tenant_id = $1 and status = 'active'", [OLD])).n).toBe(2);
    // desconectou o LinkedIn e quer voltar: o plano de 1 rede já está cheio com o Instagram
    await admin.query("update social_accounts set status = 'revoked' where tenant_id = $1 and channel = 'linkedin'", [OLD]);
    const err = await failure(admin.query("update social_accounts set status = 'active' where tenant_id = $1 and channel = 'linkedin'", [OLD]));
    expect(err).toMatchObject({ code: '23514', hint: 'plan_networks' });
  });
});
