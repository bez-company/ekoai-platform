// Coleta das métricas do Instagram contra o Postgres (BEZ-183): curtidas e comentários sempre,
// insights só com a permissão concedida, intervalo entre coletas, post apagado, token recusado e a
// leitura da última coleta por post. Meta e KMS simulados.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { runMetricsCollection, latestPostMetrics } = await import('../../platform/src/lib/instagram-metrics.ts');
const { socialTokenContext } = await import('../../platform/src/lib/secret-box.ts');

const H = 3_600_000;
const NOW = Date.parse('2026-10-22T12:00:00Z');
const box = {
  open: async ({ ciphertext }, ctx) => {
    const [c, ...rest] = Buffer.from(ciphertext, 'base64').toString().split('|');
    if (c !== ctx) throw new Error('contexto errado');
    return rest.join('|');
  },
};

const A = { ig: '17841400000000001', tenant: 'it-met-a', account: '00000000-0000-4000-8000-000000000a01', token: 'tok-a', scopes: '{instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights}' };
const B = { ig: '17841400000000002', tenant: 'it-met-b', account: '00000000-0000-4000-8000-000000000b01', token: 'tok-b', scopes: '{instagram_business_basic,instagram_business_content_publish}' };
const C = { ig: '17841400000000003', tenant: 'it-met-c', account: '00000000-0000-4000-8000-000000000c01', token: 'tok-c', scopes: '{instagram_business_basic}' };

async function seedAccount(x) {
  await admin.query('insert into tenants (id, name) values ($1, $1)', [x.tenant]);
  await admin.query(
    `insert into social_accounts (id, tenant_id, channel, external_id, handle, status, scopes, expires_at, connected_at)
     values ($1, $2, 'instagram', $4, 'doce_ponto', 'active', $3, now() + interval '40 days', now() - interval '5 days')`,
    [x.account, x.tenant, x.scopes, x.ig],
  );
  const ciphertext = Buffer.from(`${socialTokenContext(x.account)}|${x.token}`).toString('base64');
  await admin.query("insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values ($1, $2, 'v1')", [x.account, ciphertext]);
}

async function seedPost(tenant, mediaId, publishedAgoMs) {
  const { rows } = await admin.query(
    `insert into posts (tenant_id, pillar, channel, channels, is_dry_run, published_at)
     values ($1, 'post', 'instagram', $2, false, $3) returning id`,
    [tenant, JSON.stringify({ instagram: { id: mediaId } }), new Date(NOW - publishedAgoMs).toISOString()],
  );
  return rows[0].id;
}

// Meta simulada: responde pelo caminho e pelo token da URL.
const calls = [];
const fetchFn = async (input) => {
  const u = new URL(input.toString());
  const token = u.searchParams.get('access_token');
  const path = u.pathname.split('/').slice(2).join('/');
  calls.push({ token, path });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (token === 'tok-c') return json({ error: { code: 190, type: 'OAuthException' } }, 400);
  if (path === '1000000002') return json({ error: { code: 100, error_subcode: 33 } }, 400);
  if (path.endsWith('/insights')) return json({ data: [{ name: 'reach', values: [{ value: 400 }] }, { name: 'saved', values: [{ value: 5 }] }, { name: 'total_interactions', values: [{ value: 40 }] }] });
  return json({ like_count: 30, comments_count: 4, id: path });
};

let postA1, postA2, postAOld, postB1, postC1;

beforeAll(async () => {
  await resetTenantData(admin, [A.tenant, B.tenant, C.tenant]);
  for (const x of [A, B, C]) await seedAccount(x);
  postA1 = await seedPost(A.tenant, '1000000001', 3 * H);
  postA2 = await seedPost(A.tenant, '1000000002', 3 * H); // apagado no Instagram
  postAOld = await seedPost(A.tenant, '1000000003', 40 * 24 * H); // fora da janela
  postB1 = await seedPost(B.tenant, '1000000004', 5 * 24 * H);
  postC1 = await seedPost(C.tenant, '1000000005', 3 * H);
});
afterAll(async () => {
  await resetTenantData(admin, [A.tenant, B.tenant, C.tenant]);
  await admin.end();
});

describe('coleta', () => {
  it('primeira rodada: coleta quem está na janela, pula o apagado e o token recusado', async () => {
    const s = await runMetricsCollection({ box, fetchFn, nowMs: NOW });
    expect(s).toEqual({ accounts: 3, collected: 2, skipped: 0, gone: 1, failed: 1 });
    const rows = (await admin.query('select tenant_id, post_id, likes, comments, reach, saves, total_interactions, engagement_score from metrics_snapshots order by tenant_id')).rows;
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.post_id === postA1);
    expect(a).toMatchObject({ tenant_id: A.tenant, likes: 30, comments: 4, reach: 400, saves: 5, total_interactions: 40 });
    expect(Number(a.engagement_score)).toBe(0.1);
    expect(rows.find((r) => r.post_id === postB1)).toMatchObject({ tenant_id: B.tenant, likes: 30, reach: null, total_interactions: null, engagement_score: null });
    expect(calls.some((c) => c.token === 'tok-b' && c.path.endsWith('/insights'))).toBe(false);
    expect(calls.some((c) => c.path === '1000000003')).toBe(false);
  });

  it('rodada logo depois não coleta de novo; 5 h depois coleta o post novo e espera o de 5 dias', async () => {
    expect((await runMetricsCollection({ box, fetchFn, nowMs: NOW + H })).collected).toBe(0);
    const later = await runMetricsCollection({ box, fetchFn, nowMs: NOW + 5 * H });
    expect(later.collected).toBe(1);
    expect((await admin.query('select count(*)::int as n from metrics_snapshots where post_id = $1', [postA1])).rows[0].n).toBe(2);
  });
});

describe('leitura por post', () => {
  it('devolve a última coleta de cada post da conta, e nada de outra conta', async () => {
    const a = await latestPostMetrics(tenantDb(A.tenant), [postA1, postA2, postB1]);
    expect(Object.keys(a)).toEqual([postA1]);
    expect(a[postA1]).toMatchObject({ likes: 30, comments: 4, reach: 400, saves: 5, interactions: 40, engagement: 0.1 });
    expect(a[postA1].capturedAt).toBe(new Date(NOW + 5 * H).toISOString());
    expect(await latestPostMetrics(tenantDb(A.tenant), [])).toEqual({});
    void postAOld;
    void postC1;
  });
});
