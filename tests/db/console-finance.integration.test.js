// O custo real do Console › Financeiro contra o Postgres (SPEC 031, entrega 3): soma de cost_usd por conta, por post e por chamada, no mês de
// UTC; uma conta só aparece com uso, e um post só abre dentro da conta dele.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { financeAccounts, financePosts, financePost, getPricing, savePricing } = await import('../../platform/src/lib/console-finance.ts');
const { costByGroup } = await import('../../platform/src/lib/console-finance-model.ts');

const A = 'it-fin-a';
const B = 'it-fin-b';
const C = 'it-fin-c';
let n = 0;
const hash = () => String(++n).padStart(64, '0');
const brief = async (tenant, idea, status, at) => (await admin.query("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, created_at) values ($1, 'dica', $2, $3, 'platform', 'informativo', $4) returning id", [tenant, idea, status, at])).rows[0].id;
const run = (tenant, briefId, step, channel, cost, at, status = 'done') => admin.query('insert into generation_runs (tenant_id, brief_id, step, input_hash, status, channel, cost_usd, input_tokens, output_tokens, model, created_at) values ($1, $2, $3, $4, $5, $6, $7, 100, 50, $8, $9)', [tenant, briefId, step, hash(), status, channel, cost, 'gemini-teste', at]);

let first;
let second;
let other;
beforeAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.query("insert into tenants (id, name) values ($1, 'Conta A'), ($2, 'Conta B'), ($3, 'Conta sem uso')", [A, B, C]);
  first = await brief(A, '3 sinais de bolo pronto', 'approved', '2026-10-28T12:00:00Z');
  await run(A, first, 'writer', 'instagram', 0.0024, '2026-10-28T12:01:00Z');
  await run(A, first, 'adapt', 'linkedin', 0.001, '2026-10-28T12:02:00Z');
  await run(A, first, 'critic', 'linkedin', 0.0012, '2026-10-28T12:03:00Z');
  await run(A, first, 'fix', 'instagram', 0.0006, '2026-10-28T12:04:00Z', 'failed'); // a falha também custou
  second = await brief(A, 'Entrega no mesmo dia', 'ready', '2026-10-05T12:00:00Z');
  await run(A, second, 'visual', 'instagram', 0.0672, '2026-10-05T12:01:00Z');
  await brief(A, 'Pedido de setembro', 'ready', '2026-09-30T23:59:59Z');
  await run(A, await brief(A, 'Outro de setembro', 'ready', '2026-09-30T12:00:00Z'), 'writer', 'instagram', 9, '2026-09-30T23:59:59Z');
  await run(A, second, 'writer', 'instagram', 7, '2026-11-01T00:00:00Z'); // primeiro instante de novembro
  other = await brief(B, 'Post da conta B', 'ready', '2026-10-10T12:00:00Z');
  await run(B, other, 'writer', 'instagram', 0.5, '2026-10-10T12:01:00Z');
});

afterAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.end();
});

describe('custo por conta', () => {
  it('soma o custo do mês de cada conta com uso, da mais cara para a mais barata, e deixa de fora a que não usou', async () => {
    const list = await financeAccounts('2026-10');
    expect(list.map((a) => [a.id, a.posts])).toEqual([[B, 1], [A, 2]]);
    expect(list.find((a) => a.id === A).costUsd).toBeCloseTo(0.0024 + 0.001 + 0.0012 + 0.0006 + 0.0672, 8);
    expect(list.find((a) => a.id === B).costUsd).toBeCloseTo(0.5, 8);
    expect(list.map((a) => a.id)).not.toContain(C);
  });

  it('o mês é o de UTC: a chamada do último segundo de setembro e a do primeiro de novembro não são de outubro', async () => {
    expect((await financeAccounts('2026-09')).find((a) => a.id === A).costUsd).toBe(9);
    expect((await financeAccounts('2026-11')).find((a) => a.id === A).costUsd).toBe(7);
    expect(await financeAccounts('2026-06')).toEqual([]);
  });
});

describe('custo por post e por chamada', () => {
  it('lista os posts do mês da conta com o custo de cada um por grupo', async () => {
    const data = await financePosts(A, '2026-10');
    expect(data.name).toBe('Conta A');
    expect(data.total).toBe(2);
    expect(data.posts.map((p) => p.title)).toEqual(['3 sinais de bolo pronto', 'Entrega no mesmo dia']);
    const by = costByGroup(data.posts[0].runs);
    expect(by.core).toBeCloseTo(0.0024, 8);
    expect(by.networks).toBeCloseTo(0.001, 8);
    expect(by.review).toBeCloseTo(0.0012 + 0.0006, 8);
    expect(data.posts[1].costUsd).toBeCloseTo(0.0672 + 7, 8); // a chamada de novembro é do mesmo pedido: o custo do post soma tudo
  });

  it('abre as chamadas de um post em ordem, e só dentro da conta dele', async () => {
    const post = await financePost(A, first);
    expect(post.runs.map((r) => [r.step, r.channel, r.status])).toEqual([['writer', 'instagram', 'done'], ['adapt', 'linkedin', 'done'], ['critic', 'linkedin', 'done'], ['fix', 'instagram', 'failed']]);
    expect(post.runs[0]).toMatchObject({ model: 'gemini-teste', inputTokens: 100, outputTokens: 50 });
    expect(await financePost(B, first)).toBeNull();
    expect(await financePost(A, other)).toBeNull();
    expect(await financePost(A, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await financePosts('conta-que-nao-existe', '2026-10')).toBeNull();
  });
});

// A política de preço (a margem) e a cobrança prevista (SPEC 031): o preço de cada post sai do custo dele, com mínimo e arredondamento; o
// custo de pedido que não virou post aparece como "sem receita"; e a auditoria guarda só que o preço mudou, nunca os valores.
describe('preço, cobrança prevista e lucro', () => {
  const D = 'it-fin-d';
  const ADMIN = '00000000-0000-4000-8000-000000000761';
  const ZERO = { markupPercent: 0, minimumPerPostBrl: 0, roundUpToBrl: 0, targetMarginPercent: 0 };
  const POLICY = { markupPercent: 300, minimumPerPostBrl: 1, roundUpToBrl: 0.05, targetMarginPercent: 70 };

  beforeAll(async () => {
    await admin.query("insert into tenants (id, name) values ($1, 'Conta D') on conflict (id) do nothing", [D]);
    await admin.query("insert into users (id, email, name) values ($1, 'it-fin-admin@example.test', 'Admin') on conflict (id) do nothing", [ADMIN]);
    const small = await brief(D, 'Post barato', 'ready', '2026-10-05T12:00:00Z');
    await run(D, small, 'writer', 'instagram', 0.01, '2026-10-05T12:01:00Z');
    const big = await brief(D, 'Post com imagem', 'approved', '2026-10-06T12:00:00Z');
    await run(D, big, 'writer', 'instagram', 0.03, '2026-10-06T12:01:00Z');
    await run(D, big, 'visual', 'instagram', 0.07, '2026-10-06T12:02:00Z');
    const failed = await brief(D, 'Pedido que falhou', 'failed', '2026-10-07T12:00:00Z');
    await run(D, failed, 'writer', 'instagram', 0.2, '2026-10-07T12:01:00Z', 'failed');
  });
  afterAll(async () => {
    await savePricing(ZERO, ADMIN);
    await admin.query("delete from platform_pricing where false");
    await resetTenantData(admin, [D]);
  });

  it('a linha nasce zerada (preço indefinido) e a cobrança prevista não existe sem ele', async () => {
    await savePricing(ZERO, ADMIN);
    expect(await getPricing()).toEqual(ZERO);
    const d = (await financeAccounts('2026-10')).find((a) => a.id === D);
    expect(d.priceBrl).toBeNull();
  });

  it('com o preço definido, cada post sai do custo dele com mínimo e arredondamento, e o custo do pedido que falhou é "sem receita"', async () => {
    await savePricing(POLICY, ADMIN);
    expect(await getPricing()).toEqual(POLICY);
    const d = (await financeAccounts('2026-10')).find((a) => a.id === D);
    // post barato: 0,01 US$ = R$ 0,055 × 4 = 0,22, vale o mínimo de 1,00. Post com imagem: 0,10 US$ = R$ 0,55 × 4 = 2,20.
    expect(d.priceBrl).toBeCloseTo(3.2, 6);
    expect(d.postsCostUsd).toBeCloseTo(0.11, 8);
    expect(d.noRevenueCostUsd).toBeCloseTo(0.2, 8);
    expect(d.costUsd).toBeCloseTo(0.31, 8);
    expect(d.posts).toBe(2);
  });

  it('a auditoria guarda que o preço mudou e não guarda os valores', async () => {
    await savePricing({ ...POLICY, markupPercent: 450 }, ADMIN);
    const rows = (await admin.query("select tenant_id, actor_kind, action, metadata from audit_events where action = 'console.pricing_changed' and actor_user_id = $1", [ADMIN])).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).toMatchObject({ tenant_id: null, actor_kind: 'platform_admin', metadata: {} });
      expect(JSON.stringify(r)).not.toContain('450');
    }
  });

  it('a tabela da política não é lida nem gravada por uma conta de cliente', async () => {
    const rls = (await admin.query("select relrowsecurity as on from pg_class where relname = 'platform_pricing'")).rows[0];
    expect(rls.on).toBe(true);
    const policies = (await admin.query("select count(*)::int as n from pg_policies where tablename = 'platform_pricing'")).rows[0];
    expect(policies.n).toBe(0);
  });
});
