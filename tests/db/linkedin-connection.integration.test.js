// Conexão e renovação do LinkedIn contra o Postgres (SPEC 028, BEZ-423): o token (e o refresh token) entram cifrados e atômicos com a
// conta, conectar outro perfil substitui o anterior, desconectar apaga o token pelo gatilho e uma conta nunca recebe o token de outra.
// A renovação renova quando há refresh token, avisa uma vez quando não há, manda reconectar o vencido ou recusado e adia a falha
// passageira. LinkedIn e KMS simulados; nenhum token aparece em aviso ou auditoria.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const social = await import('../../platform/src/lib/social-accounts.ts');
const { runLinkedInRefresh } = await import('../../platform/src/lib/linkedin-refresh.ts');
const { socialTokenContext } = await import('../../platform/src/lib/secret-box.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');
const { ConnectError } = await import('../../platform/src/lib/linkedin-oauth-model.ts');

const D = 86_400_000;
const USER = '00000000-0000-4000-8000-000000000701';
const A = 'it-li-a';
const B = 'it-li-b';
const ta = tenantDb(A);
const tb = tenantDb(B);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rejects = async (promise) => promise.then(() => null, (e) => e);

// KMS de memória: o "cifrado" só abre com o mesmo contexto.
const box = {
  seal: async (plain, ctx) => ({ ciphertext: Buffer.from(`${ctx}|${plain}`).toString('base64'), keyVersion: 'projects/p/keyRings/k/cryptoKeys/social-tokens/cryptoKeyVersions/1' }),
  open: async ({ ciphertext }, ctx) => {
    const [c, ...rest] = Buffer.from(ciphertext, 'base64').toString().split('|');
    if (c !== ctx) throw new Error('contexto errado');
    return rest.join('|');
  },
};

const connected = (memberId, { token = 'AQX-token-1', refresh = null, days = 60, name = 'Ana Ribeiro' } = {}) => ({
  accessToken: token,
  refreshToken: refresh,
  expiresAt: new Date(Date.now() + days * D),
  scopes: ['openid', 'profile', 'w_member_social'],
  profile: { memberId, name },
});

describe('conectar', () => {
  beforeAll(async () => {
    await resetTenantData(admin, [A, B]);
    await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2) on conflict (id) do nothing', [A, B]);
  });
  afterAll(() => resetTenantData(admin, [A, B]));

  it('grava a conta ativa com o token e o refresh token cifrados, nunca em texto', async () => {
    const saved = await social.saveLinkedInConnection(ta, { userId: null, connected: connected('mem-aaa', { refresh: 'RT-secreto' }) }, box);
    expect(saved.handle).toBe('Ana Ribeiro');
    const acc = await one('select channel, external_id, handle, status, scopes, connected_by from social_accounts where id = $1', [saved.id]);
    expect(acc).toMatchObject({ channel: 'linkedin', external_id: 'mem-aaa', handle: 'Ana Ribeiro', status: 'active', scopes: ['openid', 'profile', 'w_member_social'] });
    const sec = await one('select access_token_ciphertext, refresh_token_ciphertext from social_account_secrets where social_account_id = $1', [saved.id]);
    expect(sec.access_token_ciphertext).not.toContain('AQX-token-1');
    expect(sec.refresh_token_ciphertext).not.toContain('RT-secreto');
    expect(await box.open({ ciphertext: sec.refresh_token_ciphertext }, socialTokenContext(saved.id))).toBe('RT-secreto');
    expect(await one("select actor_kind, metadata from audit_events where tenant_id = $1 and action = 'social_account.connected'", [A])).toMatchObject({ metadata: { channel: 'linkedin', handle: 'Ana Ribeiro' } });
  });

  it('a credencial da publicação é a da conta, com o autor do post', async () => {
    expect(await social.linkedinCredentials(ta, box)).toEqual({ token: 'AQX-token-1', authorUrn: 'urn:li:person:mem-aaa' });
  });

  it('sem conexão, vencida ou em outra conta, a publicação falha com o próximo passo e nunca usa o token alheio', async () => {
    const none = await rejects(social.linkedinCredentials(tb, box));
    expect(none).toBeInstanceOf(UserError);
    expect(none.message).toContain('Nenhum LinkedIn conectado');
    const expired = await rejects(social.linkedinCredentials(ta, box, Date.now() + 61 * D));
    expect(expired).toBeInstanceOf(UserError);
    expect(expired.message).toContain('venceu');
  });

  it('reconectar o mesmo perfil mantém a conta, troca o token e limpa o aviso de vencimento', async () => {
    const before = await one("select id from social_accounts where tenant_id = $1 and channel = 'linkedin'", [A]);
    await admin.query("update social_accounts set status_reason = 'expiring_soon' where id = $1", [before.id]);
    const again = await social.saveLinkedInConnection(ta, { userId: null, connected: connected('mem-aaa', { token: 'AQX-token-2' }) }, box);
    expect(again.id).toBe(before.id);
    expect(await social.linkedinCredentials(ta, box)).toMatchObject({ token: 'AQX-token-2' });
    expect(await one('select status, status_reason from social_accounts where id = $1', [again.id])).toEqual({ status: 'active', status_reason: null });
    // o LinkedIn não mandou refresh token desta vez: o anterior sai, não fica um velho
    expect((await one('select refresh_token_ciphertext from social_account_secrets where social_account_id = $1', [again.id])).refresh_token_ciphertext).toBeNull();
    expect((await admin.query("select 1 from social_accounts where tenant_id = $1 and channel = 'linkedin'", [A])).rows).toHaveLength(1);
  });

  it('conectar outro perfil substitui o anterior: o antigo é revogado e perde o token', async () => {
    const old = await one("select id from social_accounts where tenant_id = $1 and channel = 'linkedin' and status = 'active'", [A]);
    const next = await social.saveLinkedInConnection(ta, { userId: null, connected: connected('mem-bbb', { token: 'AQX-bbb', name: 'Bruno Costa' }) }, box);
    expect(next.id).not.toBe(old.id);
    expect(await one('select status, status_reason from social_accounts where id = $1', [old.id])).toEqual({ status: 'revoked', status_reason: 'replaced' });
    expect(await one('select 1 as n from social_account_secrets where social_account_id = $1', [old.id])).toBeUndefined();
    expect(await social.linkedinCredentials(ta, box)).toEqual({ token: 'AQX-bbb', authorUrn: 'urn:li:person:mem-bbb' });
  });

  it('o mesmo perfil não conecta em duas contas da Ekoai ao mesmo tempo', async () => {
    const err = await rejects(social.saveLinkedInConnection(tb, { userId: null, connected: connected('mem-bbb') }, box));
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.flash).toBe('taken');
    expect((await admin.query("select 1 from social_accounts where tenant_id = $1 and channel = 'linkedin'", [B])).rows).toHaveLength(0);
    expect((await admin.query('select 1 from social_account_secrets s join social_accounts a on a.id = s.social_account_id where a.tenant_id = $1', [B])).rows).toHaveLength(0);
  });

  it('desconectar apaga o token pelo gatilho, grava a auditoria do LinkedIn e libera o perfil', async () => {
    const live = await one("select id from social_accounts where tenant_id = $1 and channel = 'linkedin' and status = 'active'", [A]);
    expect(await social.disconnectSocialAccount(ta, USER, live.id)).toBe(true);
    expect(await one('select 1 as n from social_account_secrets where social_account_id = $1', [live.id])).toBeUndefined();
    expect(await one("select metadata from audit_events where tenant_id = $1 and action = 'social_account.disconnected'", [A])).toMatchObject({ metadata: { channel: 'linkedin' } });
    const ok = await social.saveLinkedInConnection(tb, { userId: null, connected: connected('mem-bbb', { name: 'Bruno Costa' }) }, box);
    expect(ok.handle).toBe('Bruno Costa');
  });

  it('o Instagram e o LinkedIn da mesma conta convivem sem se tocar', async () => {
    const list = await social.listSocialAccounts(tb);
    expect(list.map((a) => a.channel)).toEqual(['linkedin']);
    await expect(social.instagramCredentials(tb, box)).rejects.toBeInstanceOf(UserError);
  });
});

// ── Renovação ─────────────────────────────────────────────────────────────────────────────────

const R = Object.fromEntries(['due', 'norefresh', 'far', 'expired', 'rejected', 'transient', 'revoked'].map((k, i) => [k, { tenant: `it-lir-${k}`, id: `00000000-0000-4000-8000-0000000007${String(i + 1).padStart(2, '0')}`, member: `mem-${k}` }]));
const tenants = Object.values(R).map((x) => x.tenant);
const APP = { clientId: 'cid', clientSecret: 'secret' };

async function seed(key, { days, refresh = null, status = 'active' }) {
  const x = R[key];
  await admin.query('insert into tenants (id, name) values ($1, $2)', [x.tenant, x.tenant]);
  await admin.query(
    `insert into social_accounts (id, tenant_id, channel, external_id, handle, status, scopes, expires_at)
     values ($1, $2, 'linkedin', $3, $4, $5, '{openid,profile,w_member_social}', now() + ($6 || ' days')::interval)`,
    [x.id, x.tenant, x.member, `Pessoa ${key}`, status, String(days)],
  );
  if (status !== 'revoked') {
    const access = await box.seal(`at-${key}`, socialTokenContext(x.id));
    const rt = refresh ? await box.seal(refresh, socialTokenContext(x.id)) : null;
    await admin.query('insert into social_account_secrets (social_account_id, access_token_ciphertext, refresh_token_ciphertext, key_version) values ($1, $2, $3, $4)', [x.id, access.ciphertext, rt?.ciphertext ?? null, access.keyVersion]);
  }
}

// LinkedIn simulado: a resposta depende do refresh token que chega no corpo.
function fakeLinkedIn(plan) {
  const seen = [];
  const fetchFn = async (_input, init) => {
    const rt = new URLSearchParams(init.body).get('refresh_token');
    seen.push(rt);
    const r = plan[rt];
    if (!r) throw new Error(`refresh token inesperado: ${rt}`);
    return new Response(r.body, { status: r.status ?? 200 });
  };
  return { seen, fetchFn };
}
const plan = {
  'rt-due': { body: JSON.stringify({ access_token: 'at-due-novo', expires_in: 5184000, refresh_token: 'rt-due-novo', scope: 'openid,profile,w_member_social' }) },
  'rt-rejected': { status: 400, body: '{"error":"invalid_grant","error_description":"The provided refresh token is expired"}' },
  'rt-transient': { status: 503, body: 'indisponível' },
};
const notices = async (key, kind) => (await admin.query('select kind, level, audience, title, body, link from notifications where tenant_id = $1 and kind = $2', [R[key].tenant, kind])).rows;
const account = (key) => one('select status, status_reason, expires_at, refreshed_at from social_accounts where id = $1', [R[key].id]);

describe('renovação do LinkedIn', () => {
  beforeAll(async () => {
    await resetTenantData(admin, tenants);
    await seed('due', { days: 5, refresh: 'rt-due' });
    await seed('norefresh', { days: 10 });
    await seed('far', { days: 40, refresh: 'rt-far' });
    await seed('expired', { days: -1, refresh: 'rt-expired' });
    await seed('rejected', { days: 3, refresh: 'rt-rejected' });
    await seed('transient', { days: 3, refresh: 'rt-transient' });
    await seed('revoked', { days: 2, status: 'revoked' });
  });
  afterAll(async () => {
    await resetTenantData(admin, tenants);
    await admin.end();
  });

  it('primeira rodada: conta o que fez em cada caso', async () => {
    const li = fakeLinkedIn(plan);
    const summary = await runLinkedInRefresh({ box, fetchFn: li.fetchFn, nowMs: Date.now(), app: APP });
    // a que vence em 40 dias e a revogada nem entram na lista
    expect(summary).toEqual({ checked: 5, refreshed: 1, warned: 1, retry: 1, reauth: 2 });
    // só chama o LinkedIn para quem tem refresh token e está na janela: nunca para o vencido nem para quem não tem
    expect([...li.seen].sort()).toEqual(['rt-due', 'rt-rejected', 'rt-transient']);
  });

  it('renovada: token e refresh token novos cifrados, prazo de 60 dias, e a credencial já é a nova', async () => {
    const a = await account('due');
    expect(a.status).toBe('active');
    expect(new Date(a.expires_at).getTime()).toBeGreaterThan(Date.now() + 59 * D);
    expect(a.refreshed_at).not.toBeNull();
    expect(await social.linkedinCredentials(tenantDb(R.due.tenant), box)).toEqual({ token: 'at-due-novo', authorUrn: 'urn:li:person:mem-due' });
    expect(await social.openAccountRefreshToken(R.due.id, box)).toBe('rt-due-novo');
    const sec = await one('select access_token_ciphertext, refresh_token_ciphertext from social_account_secrets where social_account_id = $1', [R.due.id]);
    expect(JSON.stringify(sec)).not.toMatch(/at-due-novo|rt-due-novo/);
  });

  it('sem refresh token avisa uma vez e a conta segue ativa até vencer', async () => {
    expect(await account('norefresh')).toMatchObject({ status: 'active', status_reason: 'expiring_soon' });
    const n = await notices('norefresh', 'linkedin.expiring');
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ level: 'warning', audience: 'admin', title: 'O acesso ao LinkedIn vence em breve', link: '/configuracoes/canais' });
    expect(n[0].body).toMatch(/vence em \d+ dias/);
    expect(n[0].body).toContain('Pessoa norefresh');
    expect(await social.linkedinCredentials(tenantDb(R.norefresh.tenant), box)).toMatchObject({ token: 'at-norefresh' });
  });

  it('vencida e recusada pedem reconexão, com aviso e auditoria sem token', async () => {
    for (const [k, reason] of [['expired', 'token_expired'], ['rejected', 'token_rejected']]) {
      expect(await account(k)).toMatchObject({ status: 'reauth_required', status_reason: reason });
      const n = await notices(k, 'linkedin.reauth');
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ level: 'warning', audience: 'admin', title: 'Reconecte o LinkedIn', link: '/configuracoes/canais' });
      const audit = await one("select actor_kind, metadata from audit_events where tenant_id = $1 and action = 'social_account.reauth_required'", [R[k].tenant]);
      expect(audit).toMatchObject({ actor_kind: 'system', metadata: { channel: 'linkedin', reason } });
      expect(JSON.stringify([n, audit])).not.toMatch(/at-|rt-/);
      await expect(social.linkedinCredentials(tenantDb(R[k].tenant), box)).rejects.toBeInstanceOf(UserError);
    }
  });

  it('falha passageira não muda a conta nem avisa; a longe de vencer e a revogada ficam como estavam', async () => {
    expect(await account('transient')).toMatchObject({ status: 'active', status_reason: null });
    expect(await notices('transient', 'linkedin.reauth')).toEqual([]);
    expect(await account('far')).toMatchObject({ status: 'active', refreshed_at: null });
    expect(await account('revoked')).toMatchObject({ status: 'revoked' });
  });

  it('segunda rodada: não repete aviso nem renova de novo; a passageira segue tentando', async () => {
    const li = fakeLinkedIn(plan);
    const summary = await runLinkedInRefresh({ box, fetchFn: li.fetchFn, nowMs: Date.now(), app: APP });
    expect(summary).toEqual({ checked: 2, refreshed: 0, warned: 0, retry: 1, reauth: 0 });
    expect(li.seen).toEqual(['rt-transient']);
    expect(await notices('norefresh', 'linkedin.expiring')).toHaveLength(1);
    expect(await notices('expired', 'linkedin.reauth')).toHaveLength(1);
  });

  it('sem o app configurado neste ambiente, quem tem refresh token espera e o resto segue igual', async () => {
    const summary = await runLinkedInRefresh({ box, fetchFn: async () => { throw new Error('não deveria chamar'); }, nowMs: Date.now(), app: null });
    expect(summary).toEqual({ checked: 2, refreshed: 0, warned: 0, retry: 1, reauth: 0 });
  });
});
