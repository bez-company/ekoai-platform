// Leitura do público contra o Postgres (SPEC 022, BEZ-206): faixa etária, gênero e horário online com a
// permissão de insights, sem ela, com menos de 100 seguidores e com token recusado; uma leitura por dia;
// e a leitura mais recente para a tela. Meta e KMS simulados.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { runAudienceCollection, latestAudience } = await import('../../platform/src/lib/audience.ts');
const { socialTokenContext } = await import('../../platform/src/lib/secret-box.ts');

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const box = {
  open: async ({ ciphertext }, ctx) => {
    const [c, ...rest] = Buffer.from(ciphertext, 'base64').toString().split('|');
    if (c !== ctx) throw new Error('contexto errado');
    return rest.join('|');
  },
};

const ALL = '{instagram_business_basic,instagram_business_manage_insights}';
const A = { ig: '17841400000000101', tenant: 'it-aud-a', account: '00000000-0000-4000-8000-0000000a0a01', token: 'tok-a', scopes: ALL, followers: 2310 };
const B = { ig: '17841400000000102', tenant: 'it-aud-b', account: '00000000-0000-4000-8000-0000000a0b01', token: 'tok-b', scopes: '{instagram_business_basic}', followers: 2310 };
const C = { ig: '17841400000000103', tenant: 'it-aud-c', account: '00000000-0000-4000-8000-0000000a0c01', token: 'tok-c', scopes: ALL, followers: 87 };
const D = { ig: '17841400000000104', tenant: 'it-aud-d', account: '00000000-0000-4000-8000-0000000a0d01', token: 'tok-d', scopes: ALL, followers: 2310 };
const E = { ig: '17841400000000105', tenant: 'it-aud-e', account: '00000000-0000-4000-8000-0000000a0e01', token: 'tok-e', scopes: ALL, followers: 2310 };

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

const demographics = (breakdown, results) => ({
  data: [{ name: 'follower_demographics', period: 'lifetime', total_value: { breakdowns: [{ dimension_keys: ['timeframe', breakdown], results: results.map(([d, value]) => ({ dimension_values: ['THIS_MONTH', d], value })) }] } }],
});
const AGE = demographics('age', [['25-34', 38], ['35-44', 29], ['18-24', 14], ['45-54', 11], ['55-64', 4], ['13-17', 2], ['65+', 2]]);
const GENDER = demographics('gender', [['F', 71], ['M', 27], ['U', 2]]);
const ONLINE = { data: [{ name: 'online_followers', period: 'lifetime', values: [{ value: Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h === 19 ? 100 : 20])) }] }] };

// Meta simulada: responde pelo token da URL, pela métrica e pelo breakdown pedidos.
const calls = [];
const fetchFn = async (input) => {
  const u = new URL(input.toString());
  const token = u.searchParams.get('access_token');
  const metric = u.searchParams.get('metric');
  const breakdown = u.searchParams.get('breakdown');
  const timeframe = u.searchParams.get('timeframe');
  calls.push({ token, metric, breakdown, timeframe });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (token === 'tok-d') return json({ error: { code: 190, type: 'OAuthException' } }, 400);
  if (!metric) return json({ followers_count: [A, B, C, E].find((x) => x.token === token)?.followers ?? 0, id: 'x' });
  if (metric === 'online_followers') return token === 'tok-e' ? json({ error: { code: 100, message: 'Invalid metric' } }, 400) : json(ONLINE);
  // tok-e: a Meta recusa o timeframe novo e aceita o antigo
  if (token === 'tok-e' && timeframe === 'this_month') return json({ error: { code: 100, message: 'Invalid timeframe' } }, 400);
  return json(breakdown === 'age' ? AGE : GENDER);
};

beforeAll(async () => {
  await resetTenantData(admin, [A.tenant, B.tenant, C.tenant, D.tenant, E.tenant]);
  for (const x of [A, B, C, D, E]) await seedAccount(x);
});
afterAll(async () => {
  await resetTenantData(admin, [A.tenant, B.tenant, C.tenant, D.tenant, E.tenant]);
  await admin.end();
});

const rowOf = async (tenant, day = '2026-10-26') =>
  (await admin.query('select followers, age, gender, online_hours, status, captured_on::text as day from audience_snapshots where tenant_id = $1 and captured_on = $2', [tenant, day])).rows[0];

describe('leitura do público', () => {
  it('primeira rodada: cada conta fica no estado certo e o token recusado não grava', async () => {
    const s = await runAudienceCollection({ box, fetchFn, nowMs: NOW });
    expect(s).toEqual({ accounts: 5, saved: 4, skipped: 0, failed: 1 });

    const a = await rowOf(A.tenant);
    expect(a.status).toBe('ok');
    expect(a.followers).toBe(2310);
    expect(a.age).toMatchObject({ '25-34': 0.38, '35-44': 0.29, '65+': 0.02 });
    expect(a.gender).toEqual({ F: 0.71, M: 0.27, U: 0.02 });
    expect(a.online_hours).toHaveLength(24);
    expect(a.online_hours[19]).toBe(1);

    // sem a permissão de insights: guarda só os seguidores e não chama a rota de insights
    expect(await rowOf(B.tenant)).toMatchObject({ status: 'no_permission', followers: 2310, age: null, gender: null, online_hours: null });
    expect(calls.some((c) => c.token === 'tok-b' && c.metric)).toBe(false);

    // menos de 100 seguidores: também não chama insights
    expect(await rowOf(C.tenant)).toMatchObject({ status: 'too_few_followers', followers: 87, age: null });
    expect(calls.some((c) => c.token === 'tok-c' && c.metric)).toBe(false);

    expect(await rowOf(D.tenant)).toBeUndefined();

    // a Meta recusou o timeframe novo: a segunda tentativa leu a idade; o horário online falhou e o dia ainda vale
    const e = await rowOf(E.tenant);
    expect(e).toMatchObject({ status: 'ok', online_hours: null });
    expect(e.age['25-34']).toBe(0.38);
    expect(calls.filter((c) => c.token === 'tok-e' && c.breakdown === 'age').map((c) => c.timeframe)).toEqual(['this_month', 'last_30_days']);
  });

  it('segunda rodada no mesmo dia: não lê de novo o que está resolvido, e tenta outra vez o que dependia da pessoa', async () => {
    calls.length = 0;
    const s = await runAudienceCollection({ box, fetchFn, nowMs: NOW + 6 * 3_600_000 });
    // A, C e E já estão resolvidos (ok ou poucos seguidores); B (sem permissão) e D (token) tentam de novo
    expect(s).toEqual({ accounts: 5, saved: 1, skipped: 3, failed: 1 });
    expect(calls.every((c) => c.token === 'tok-b' || c.token === 'tok-d')).toBe(true);
    expect((await admin.query("select count(*)::int as n from audience_snapshots where tenant_id = $1", [B.tenant])).rows[0].n).toBe(1);
  });

  it('no dia seguinte grava outra linha', async () => {
    await runAudienceCollection({ box, fetchFn, nowMs: NOW + DAY });
    expect((await admin.query("select count(*)::int as n from audience_snapshots where tenant_id = $1", [A.tenant])).rows[0].n).toBe(2);
    expect(await rowOf(A.tenant, '2026-10-27')).toMatchObject({ status: 'ok' });
  });
});

describe('leitura para a tela', () => {
  it('devolve a leitura mais recente com dado e, sem nenhuma, a mais recente de qualquer estado', async () => {
    const a = await latestAudience(tenantDb(A.tenant));
    expect(a).toMatchObject({ status: 'ok', followers: 2310, capturedOn: '2026-10-27' });
    expect(a.age['25-34']).toBe(0.38);
    expect(await latestAudience(tenantDb(C.tenant))).toMatchObject({ status: 'too_few_followers', followers: 87, age: null });
    expect(await latestAudience(tenantDb(D.tenant))).toBeNull();
  });

  it('não mistura contas: o tenant B não vê a linha do A', async () => {
    const b = await latestAudience(tenantDb(B.tenant));
    expect(b.status).toBe('no_permission');
    expect(b.age).toBeNull();
  });
});
