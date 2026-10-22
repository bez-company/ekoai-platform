// Callbacks da Meta contra o Postgres (SPEC 011 R5.4, BEZ-215; migration 0034): desautorização e exclusão
// revogam a conexão em toda conta que usa aquele Instagram, o token some, os administradores são avisados,
// a auditoria registra, e a exclusão grava o pedido com código e status sem dado da pessoa.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { handleDeauthorize, handleDataDeletion, deletionStatus } = await import('../../platform/src/lib/meta-callbacks.ts');

const A = 'it-meta-a';
const B = 'it-meta-b';
const IG_A = '17841400000077001';
const IG_B = '17841400000077002';
const ACC_A = '00000000-0000-4000-8000-0000000077a1';
const ACC_B = '00000000-0000-4000-8000-0000000077b1';

async function account(id, tenant, ig) {
  await admin.query(
    `insert into social_accounts (id, tenant_id, channel, external_id, handle, status, scopes, expires_at)
     values ($1, $2, 'instagram', $3, 'doceponto', 'active', '{}', now() + interval '50 days')`,
    [id, tenant, ig],
  );
  await admin.query("insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values ($1, 'cifrado', 'v1')", [id]);
}
const row = async (id) => (await admin.query('select status, status_reason from social_accounts where id = $1', [id])).rows[0];
const secrets = async (id) => (await admin.query('select count(*)::int as n from social_account_secrets where social_account_id = $1', [id])).rows[0].n;

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from data_deletion_requests');
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await account(ACC_A, A, IG_A);
  await account(ACC_B, B, IG_B);
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from data_deletion_requests');
  await admin.end();
});

describe('desautorização', () => {
  it('revoga a conexão daquele Instagram, apaga o token, avisa e audita; a outra conta fica', async () => {
    expect(await handleDeauthorize(IG_A)).toBe(1);
    expect(await row(ACC_A)).toEqual({ status: 'revoked', status_reason: 'meta_deauthorized' });
    expect(await secrets(ACC_A)).toBe(0);
    expect((await admin.query("select title from notifications where tenant_id = $1 and kind = 'instagram.revoked'", [A])).rows).toEqual([{ title: 'Instagram desconectado' }]);
    expect((await admin.query("select actor_kind, action from audit_events where tenant_id = $1 and action = 'social_account.revoked_by_meta'", [A])).rows).toEqual([{ actor_kind: 'system', action: 'social_account.revoked_by_meta' }]);
    expect((await row(ACC_B)).status).toBe('active');
  });

  it('chamada repetida (a Meta tenta de novo) não revoga nada a mais nem avisa de novo', async () => {
    expect(await handleDeauthorize(IG_A)).toBe(0);
    expect((await admin.query("select count(*)::int as n from notifications where tenant_id = $1 and kind = 'instagram.revoked'", [A])).rows[0].n).toBe(1);
  });
});

describe('exclusão de dados', () => {
  it('revoga, grava o pedido sem o id da pessoa e devolve código e URL de status', async () => {
    const out = await handleDataDeletion(IG_B, 'https://app.example.test/');
    expect(out.url).toBe(`https://app.example.test/instagram/exclusao/${out.confirmation_code}`);
    expect(out.confirmation_code).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(await row(ACC_B)).toEqual({ status: 'revoked', status_reason: 'meta_data_deletion' });
    expect(await secrets(ACC_B)).toBe(0);
    const stored = (await admin.query('select external_user_hash, accounts_revoked from data_deletion_requests where confirmation_code = $1', [out.confirmation_code])).rows[0];
    expect(stored.accounts_revoked).toBe(1);
    expect(stored.external_user_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.external_user_hash).not.toContain(IG_B);
    expect(await deletionStatus(out.confirmation_code)).toMatchObject({ accountsRevoked: 1 });
  });

  it('pedido de quem já não tinha conexão também gera código; código desconhecido ou fora do formato não acha nada', async () => {
    const out = await handleDataDeletion('17841400000099999', 'https://app.example.test');
    expect(await deletionStatus(out.confirmation_code)).toMatchObject({ accountsRevoked: 0 });
    expect(await deletionStatus('AbCdEf0123456789_-xy')).toBeNull();
    expect(await deletionStatus("' or 1=1 --")).toBeNull();
  });
});
