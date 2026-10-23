// Renovação dos tokens de Instagram contra o Postgres (SPEC 011 R5.3): renova o que vence em até 15
// dias, espera o que é novo demais, manda reconectar o vencido ou recusado (e avisa uma vez), adia a
// falha passageira e ignora conta revogada. Meta e KMS simulados; nenhum token aparece em aviso ou auditoria.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const social = await import('../../platform/src/lib/social-accounts.ts');
const { runInstagramRefresh } = await import('../../platform/src/lib/instagram-refresh.ts');
const { socialTokenContext } = await import('../../platform/src/lib/secret-box.ts');

const D = 86_400_000;
const ids = Object.fromEntries(['due', 'far', 'young', 'expired', 'rejected', 'transient', 'revoked'].map((k, i) => [k, { tenant: `it-rf-${k}`, ig: `1784140000000${String(i).padStart(4, '0')}`, id: `00000000-0000-4000-8000-0000000007${String(i).padStart(2, '0')}` }]));
const tenants = Object.values(ids).map((x) => x.tenant);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const box = {
  seal: async (plain, ctx) => ({ ciphertext: Buffer.from(`${ctx}|${plain}`).toString('base64'), keyVersion: 'projects/p/keyRings/k/cryptoKeys/social-tokens/cryptoKeyVersions/1' }),
  open: async ({ ciphertext }, ctx) => {
    const [c, ...rest] = Buffer.from(ciphertext, 'base64').toString().split('|');
    if (c !== ctx) throw new Error('contexto errado');
    return rest.join('|');
  },
};

async function seed(key, { expiresInDays, connectedAgoMs, status = 'active', withSecret = true }) {
  const x = ids[key];
  await admin.query('insert into tenants (id, name) values ($1, $2)', [x.tenant, x.tenant]);
  await admin.query(
    `insert into social_accounts (id, tenant_id, channel, external_id, handle, status, scopes, expires_at, connected_at)
     values ($1, $2, 'instagram', $3, $4, $5, '{instagram_business_basic,instagram_business_content_publish}', now() + ($6 || ' days')::interval, now() - ($7 || ' milliseconds')::interval)`,
    [x.id, x.tenant, x.ig, `conta_${key}`, status, String(expiresInDays), String(connectedAgoMs)],
  );
  if (withSecret) {
    const sealed = await box.seal(`tok-${key}`, socialTokenContext(x.id));
    await admin.query('insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values ($1, $2, $3)', [x.id, sealed.ciphertext, sealed.keyVersion]);
  }
}

// Meta simulada: a resposta depende do token que chega na URL.
function fakeMeta(plan) {
  const seen = [];
  const fetchFn = async (input) => {
    const token = new URL(input.toString()).searchParams.get('access_token');
    seen.push(token);
    const r = plan[token];
    if (!r) throw new Error(`token inesperado: ${token}`);
    return new Response(r.body, { status: r.status ?? 200 });
  };
  return { seen, fetchFn };
}

const OK = (token) => ({ body: JSON.stringify({ access_token: `${token}-novo`, token_type: 'bearer', expires_in: 5184000 }) });
const plan = {
  'tok-due': OK('tok-due'),
  'tok-rejected': { status: 400, body: '{"error":{"message":"Error validating access token","type":"OAuthException","code":190}}' },
  'tok-transient': { status: 503, body: 'indisponível' },
};

beforeAll(async () => {
  await resetTenantData(admin, tenants);
  await seed('due', { expiresInDays: 5, connectedAgoMs: 10 * D });
  await seed('far', { expiresInDays: 40, connectedAgoMs: 20 * D });
  await seed('young', { expiresInDays: 5, connectedAgoMs: 2 * 3_600_000 });
  await seed('expired', { expiresInDays: -1, connectedAgoMs: 61 * D });
  await seed('rejected', { expiresInDays: 3, connectedAgoMs: 57 * D });
  await seed('transient', { expiresInDays: 3, connectedAgoMs: 57 * D });
  await seed('revoked', { expiresInDays: 2, connectedAgoMs: 58 * D, status: 'revoked', withSecret: false });
});
afterAll(async () => {
  await resetTenantData(admin, tenants);
  await admin.end();
});

const notices = async (key) => (await admin.query("select kind, level, audience, title, body, link from notifications where tenant_id = $1 and kind = 'instagram.reauth'", [ids[key].tenant])).rows;
const account = (key) => one('select status, status_reason, expires_at, refreshed_at from social_accounts where id = $1', [ids[key].id]);

describe('primeira rodada', () => {
  let summary;
  let meta;

  it('conta o que fez em cada caso', async () => {
    meta = fakeMeta(plan);
    summary = await runInstagramRefresh({ box, fetchFn: meta.fetchFn, nowMs: Date.now() });
    // revogada e a que vence em 40 dias nem entram na lista
    expect(summary).toEqual({ checked: 5, refreshed: 1, waiting: 1, retry: 1, reauth: 2 });
  });

  it('só chama a Meta para quem precisa de renovação, e nunca para o vencido ou novo demais', () => {
    expect([...meta.seen].sort()).toEqual(['tok-due', 'tok-rejected', 'tok-transient']);
  });

  it('renovada: token novo cifrado, prazo de 60 dias e refreshed_at', async () => {
    const a = await account('due');
    expect(a.status).toBe('active');
    expect(new Date(a.expires_at).getTime()).toBeGreaterThan(Date.now() + 59 * D);
    expect(a.refreshed_at).not.toBeNull();
    const creds = await social.instagramCredentials(tenantDb(ids.due.tenant), box);
    expect(creds).toEqual({ accountId: ids.due.ig, token: 'tok-due-novo' });
    const sec = await one('select access_token_ciphertext from social_account_secrets where social_account_id = $1', [ids.due.id]);
    expect(sec.access_token_ciphertext).not.toContain('tok-due-novo');
  });

  it('longe de vencer e nova demais ficam como estavam', async () => {
    for (const k of ['far', 'young']) {
      const a = await account(k);
      expect(a.status).toBe('active');
      expect(a.refreshed_at).toBeNull();
      expect((await social.instagramCredentials(tenantDb(ids[k].tenant), box)).token).toBe(`tok-${k}`);
    }
  });

  it('vencida e recusada pela Meta pedem reconexão, com aviso e auditoria sem token', async () => {
    for (const [k, reason] of [['expired', 'token_expired'], ['rejected', 'token_rejected']]) {
      expect(await account(k)).toMatchObject({ status: 'reauth_required', status_reason: reason });
      const n = await notices(k);
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ level: 'warning', audience: 'admin', title: 'Reconecte o Instagram', link: '/configuracoes/canais' });
      expect(n[0].body).toContain(`@conta_${k}`);
      const audit = await one("select actor_user_id, actor_kind, target_id, metadata from audit_events where tenant_id = $1 and action = 'social_account.reauth_required'", [ids[k].tenant]);
      expect(audit).toMatchObject({ actor_user_id: null, actor_kind: 'system', target_id: ids[k].id, metadata: { channel: 'instagram', reason } });
      expect(JSON.stringify([n, audit])).not.toMatch(/tok-/);
    }
  });

  it('falha passageira não muda a conta nem avisa: tenta de novo amanhã', async () => {
    expect(await account('transient')).toMatchObject({ status: 'active', status_reason: null });
    expect(await notices('transient')).toEqual([]);
    expect((await social.instagramCredentials(tenantDb(ids.transient.tenant), box)).token).toBe('tok-transient');
  });

  it('conta revogada fica de fora', async () => {
    expect(await account('revoked')).toMatchObject({ status: 'revoked' });
    expect(await notices('revoked')).toEqual([]);
  });
});

describe('segunda rodada', () => {
  it('não repete o aviso nem renova de novo; a nova demais espera e a passageira segue tentando', async () => {
    const meta = fakeMeta(plan);
    const summary = await runInstagramRefresh({ box, fetchFn: meta.fetchFn, nowMs: Date.now() });
    expect(summary).toEqual({ checked: 2, refreshed: 0, waiting: 1, retry: 1, reauth: 0 });
    expect(meta.seen).toEqual(['tok-transient']);
    expect(await notices('expired')).toHaveLength(1);
    expect(await notices('rejected')).toHaveLength(1);
  });

  it('se a Meta se recupera, a conta da falha passageira renova', async () => {
    const meta = fakeMeta({ ...plan, 'tok-transient': OK('tok-transient') });
    const summary = await runInstagramRefresh({ box, fetchFn: meta.fetchFn, nowMs: Date.now() });
    expect(summary).toMatchObject({ refreshed: 1, retry: 0 });
    expect((await social.instagramCredentials(tenantDb(ids.transient.tenant), box)).token).toBe('tok-transient-novo');
  });
});

describe('conta desconectada no meio da renovação', () => {
  it('não recebe token novo nem volta a ter segredo', async () => {
    const x = ids.revoked;
    const wrote = await social.saveRefreshedToken({ id: x.id, tenantId: x.tenant }, { accessToken: 'tok-fantasma', expiresAt: new Date(Date.now() + 60 * D) }, box);
    expect(wrote).toBe(false);
    expect((await one('select count(*)::int as n from social_account_secrets where social_account_id = $1', [x.id])).n).toBe(0);
  });
});
