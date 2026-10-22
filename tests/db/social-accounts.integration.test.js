// Conexão do Instagram contra o Postgres (SPEC 011 R5): o token entra cifrado e atômico com a conta,
// o limite do plano e a unicidade entre contas valem no banco, desconectar apaga o token pelo gatilho
// e uma conta nunca recebe o token de outra. A cifra é um KMS de memória que amarra o texto ao contexto.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const social = await import('../../platform/src/lib/social-accounts.ts');
const { ConnectError } = await import('../../platform/src/lib/instagram-oauth-model.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-social-a';
const B = 'it-social-b';
const USER = '00000000-0000-4000-8000-000000000601';
const ta = tenantDb(A);
const tb = tenantDb(B);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rejects = async (promise) => promise.then(() => null, (e) => e);

// KMS de memória: o "cifrado" só abre com o mesmo contexto, como o additionalAuthenticatedData real.
const box = {
  seal: async (plain, ctx) => ({ ciphertext: Buffer.from(`${ctx}|${plain}`).toString('base64'), keyVersion: 'projects/p/keyRings/k/cryptoKeys/social-tokens/cryptoKeyVersions/1' }),
  open: async ({ ciphertext }, ctx) => {
    const [c, ...rest] = Buffer.from(ciphertext, 'base64').toString().split('|');
    if (c !== ctx) throw new Error('contexto errado');
    return rest.join('|');
  },
};

const IG1 = '17841400000000111';
const IG2 = '17841400000000222';
const connected = (userId, token = 'IGQ-token-1', days = 60) => ({
  accessToken: token,
  expiresAt: new Date(Date.now() + days * 86_400_000),
  scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  profile: { userId, username: `user${userId.slice(-3)}`, accountType: 'BUSINESS' },
});

async function cleanup() {
  await resetTenantData(admin, [A, B]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [USER, 'it-social@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Social A', B, 'It Social B']);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('conectar', () => {
  let id;

  it('grava a conta ativa e o token só cifrado, com a versão da chave', async () => {
    const saved = await social.saveInstagramConnection(ta, { userId: USER, connected: connected(IG1) }, box);
    id = saved.id;
    const acc = await one('select tenant_id, channel, external_id, handle, status, connected_by, scopes, expires_at > now() + interval \'59 days\' as long from social_accounts where id = $1', [id]);
    expect(acc).toMatchObject({ tenant_id: A, channel: 'instagram', external_id: IG1, handle: 'user111', status: 'active', connected_by: USER, long: true });
    expect(acc.scopes).toContain('instagram_business_content_publish');
    const sec = await one('select access_token_ciphertext, refresh_token_ciphertext, key_version from social_account_secrets where social_account_id = $1', [id]);
    expect(sec.access_token_ciphertext).not.toContain('IGQ-token-1');
    expect(Buffer.from(sec.access_token_ciphertext, 'base64').toString()).not.toBe('IGQ-token-1');
    expect(sec.key_version).toMatch(/cryptoKeyVersions\/1$/);
    const audit = await one("select actor_user_id, target_id, metadata from audit_events where tenant_id = $1 and action = 'social_account.connected'", [A]);
    expect(audit).toMatchObject({ actor_user_id: USER, target_id: id, metadata: { channel: 'instagram' } });
    expect(JSON.stringify(audit)).not.toContain('IGQ-token-1');
  });

  it('a lista mostra metadados e nunca o token', async () => {
    const list = await social.listSocialAccounts(ta);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, handle: 'user111', status: 'active' });
    expect(JSON.stringify(list)).not.toMatch(/IGQ|ciphertext/);
    expect(await social.listSocialAccounts(tb)).toEqual([]);
  });

  it('a publicação recebe o token e o id da conta certa', async () => {
    expect(await social.instagramCredentials(ta, box)).toEqual({ accountId: IG1, token: 'IGQ-token-1' });
  });

  it('reconectar o mesmo Instagram atualiza a mesma linha com o token novo', async () => {
    const again = await social.saveInstagramConnection(ta, { userId: USER, connected: connected(IG1, 'IGQ-token-2') }, box);
    expect(again.id).toBe(id);
    expect((await one('select count(*)::int as n from social_accounts where tenant_id = $1', [A])).n).toBe(1);
    expect((await social.instagramCredentials(ta, box)).token).toBe('IGQ-token-2');
  });

  it('o plano de 1 Instagram barra o segundo, com a chave de limite', async () => {
    const err = await rejects(social.saveInstagramConnection(ta, { userId: USER, connected: connected(IG2) }, box));
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.flash).toBe('limit');
    expect((await one('select count(*)::int as n from social_accounts where tenant_id = $1', [A])).n).toBe(1);
  });

  it('o mesmo Instagram em outra conta da Ekoai é recusado', async () => {
    const err = await rejects(social.saveInstagramConnection(tb, { userId: USER, connected: connected(IG1, 'IGQ-outro') }, box));
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.flash).toBe('taken');
    expect((await one('select count(*)::int as n from social_account_secrets s join social_accounts a on a.id = s.social_account_id where a.tenant_id = $1', [B])).n).toBe(0);
  });

  it('falha ao gravar o token desfaz a conta: nunca fica conta ativa sem token', async () => {
    const broken = { ...box, seal: async () => ({ ciphertext: 'x', keyVersion: '' }) };
    const err = await rejects(social.saveInstagramConnection(tb, { userId: USER, connected: connected(IG2) }, broken));
    expect(err).toBeInstanceOf(Error);
    expect((await one('select count(*)::int as n from social_accounts where tenant_id = $1', [B])).n).toBe(0);
  });
});

describe('uma conta nunca usa o token de outra', () => {
  it('sem conexão a publicação falha com o próximo passo', async () => {
    const err = await rejects(social.instagramCredentials(tb, box));
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toMatch(/Nenhum Instagram conectado.*Configurações, Redes/);
  });

  it('o texto cifrado de uma conta não abre no contexto de outra', async () => {
    const row = await one('select s.access_token_ciphertext as c from social_account_secrets s join social_accounts a on a.id = s.social_account_id where a.tenant_id = $1', [A]);
    await expect(box.open({ ciphertext: row.c }, 'ekoai:social-token:outro-id')).rejects.toThrow(/contexto/);
  });

  it('token vencido pede reconexão em vez de tentar publicar', async () => {
    const err = await rejects(social.instagramCredentials(ta, box, Date.now() + 61 * 86_400_000));
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toMatch(/venceu/);
  });
});

describe('desconectar', () => {
  it('outra conta não consegue desconectar a daqui', async () => {
    const { id } = await one('select id from social_accounts where tenant_id = $1', [A]);
    expect(await social.disconnectSocialAccount(tb, USER, id)).toBe(false);
    expect((await one('select status from social_accounts where id = $1', [id])).status).toBe('active');
  });

  it('revoga, apaga o token pelo gatilho, audita e libera a vaga', async () => {
    const { id } = await one('select id from social_accounts where tenant_id = $1', [A]);
    expect(await social.disconnectSocialAccount(ta, USER, id)).toBe(true);
    expect(await one('select status, status_reason from social_accounts where id = $1', [id])).toEqual({ status: 'revoked', status_reason: 'disconnected' });
    expect((await one('select count(*)::int as n from social_account_secrets where social_account_id = $1', [id])).n).toBe(0);
    expect((await one("select count(*)::int as n from audit_events where tenant_id = $1 and action = 'social_account.disconnected'", [A])).n).toBe(1);
    expect(await social.listSocialAccounts(ta)).toEqual([]);

    const err = await rejects(social.instagramCredentials(ta, box));
    expect(err).toBeInstanceOf(UserError);

    // O segundo pedido para desconectar a mesma conta não faz nada.
    expect(await social.disconnectSocialAccount(ta, USER, id)).toBe(false);

    // A vaga volta: conecta de novo, agora outro Instagram, em linha nova.
    const next = await social.saveInstagramConnection(ta, { userId: USER, connected: connected(IG2, 'IGQ-novo') }, box);
    expect(next.id).not.toBe(id);
    expect((await social.instagramCredentials(ta, box)).accountId).toBe(IG2);
  });
});
