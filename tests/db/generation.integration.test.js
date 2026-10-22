// A geração contra o Postgres (SPEC 012 R5.1): reserva idempotente, limite mensal do plano sob
// concorrência (duas reservas no último post: só uma passa), falha libera a vaga, fatos por conta.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 6 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const gen = await import('../../platform/src/lib/generation-db.ts');
const { inputHash } = await import('../../platform/src/lib/generation-model.ts');
const facts = await import('../../platform/src/lib/company-facts.ts');

const A = 'it-gen-a';
const B = 'it-gen-b';
const PLAN = 'it-gen-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000701', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

async function brief(tenant, idea) {
  return (await one("insert into briefs (tenant_id, pillar, idea, status, source, post_kind) values ($1, 'dica', $2, 'generating', 'platform', 'informativo') returning id", [tenant, idea])).id;
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Gen', 'empresa', 5, 1, 2) on conflict (id) do update set max_posts_per_month = 2", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-gen-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'empresa', $2), ($3, $3, 'empresa', 'inicial')", [A, PLAN, B]);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('reserva idempotente', () => {
  it('a mesma entrada devolve a mesma linha; entrada nova cria outra', async () => {
    const t = tenantDb(A);
    const briefId = await brief(A, 'idempotente');
    const hash = inputHash('writer', 'texto-1', { tema: 'bolo' });
    const first = await gen.reserveRun(t, { briefId, step: 'writer', inputHash: hash, model: 'texto-1' }, 2);
    expect(first).toMatchObject({ ok: true, reused: false, run: { status: 'reserved', step: 'writer' } });
    const again = await gen.reserveRun(t, { briefId, step: 'writer', inputHash: hash, model: 'texto-1' }, 2);
    expect(again).toMatchObject({ ok: true, reused: true, run: { id: first.run.id } });

    await gen.completeRun(t, first.run.id, { result: { legenda: 'x' }, inputTokens: 10, outputTokens: 20, costUsd: 0.00005, durationMs: 800 });
    const done = await gen.reserveRun(t, { briefId, step: 'writer', inputHash: hash, model: 'texto-1' }, 2);
    expect(done).toMatchObject({ ok: true, reused: true, run: { status: 'done', result: { legenda: 'x' }, costUsd: 0.00005 } });

    const other = await gen.reserveRun(t, { briefId, step: 'writer', inputHash: inputHash('writer', 'texto-1', { tema: 'torta' }), model: 'texto-1' }, 2);
    expect(other).toMatchObject({ ok: true, reused: false });
    expect(other.run.id).not.toBe(first.run.id);
    expect((await gen.runsOfBrief(t, briefId)).map((r) => r.status)).toEqual(['done', 'reserved']);
  });

  it('texto não conta no limite; a conta vizinha não vê as linhas', async () => {
    expect(await gen.monthlyUsage(tenantDb(A), 2)).toEqual({ used: 0, max: 2, remaining: 2 });
    expect(await gen.runsOfBrief(tenantDb(B), (await admin.query('select id from briefs where tenant_id = $1 limit 1', [A])).rows[0].id)).toEqual([]);
  });
});

describe('limite mensal do plano (2 posts no plano de teste)', () => {
  it('duas reservas ao mesmo tempo no último post: uma passa, a outra recebe o limite', async () => {
    const t = tenantDb(A);
    const b1 = await brief(A, 'limite-1');
    const v1 = await gen.reserveRun(t, { briefId: b1, step: 'visual', inputHash: inputHash('visual', 'img', { n: 1 }), model: 'img' }, 2);
    expect(v1).toMatchObject({ ok: true });
    expect(await gen.monthlyUsage(t, 2)).toEqual({ used: 1, max: 2, remaining: 1 });

    const b2 = await brief(A, 'limite-2');
    const b3 = await brief(A, 'limite-3');
    const [r2, r3] = await Promise.all([
      gen.reserveRun(t, { briefId: b2, step: 'visual', inputHash: inputHash('visual', 'img', { n: 2 }), model: 'img' }, 2),
      gen.reserveRun(t, { briefId: b3, step: 'visual', inputHash: inputHash('visual', 'img', { n: 3 }), model: 'img' }, 2),
    ]);
    const outcomes = [r2, r3].map((r) => (r.ok ? 'ok' : r.reason)).sort();
    expect(outcomes).toEqual(['limit', 'ok']);
    const refused = [r2, r3].find((r) => !r.ok);
    expect(refused.usage).toEqual({ used: 2, max: 2, remaining: 0 });
    expect((await admin.query("select count(*)::int as n from generation_runs where tenant_id = $1 and step = 'visual'", [A])).rows[0].n).toBe(2);
  });

  it('"outra direção" (hash novo) também conta e é recusada no limite; a reserva repetida não', async () => {
    const t = tenantDb(A);
    const { id: briefId } = (await admin.query("select id from briefs where tenant_id = $1 and idea = 'limite-1'", [A])).rows[0];
    const sameAgain = await gen.reserveRun(t, { briefId, step: 'visual', inputHash: inputHash('visual', 'img', { n: 1 }), model: 'img' }, 2);
    expect(sameAgain).toMatchObject({ ok: true, reused: true });
    const other = await gen.reserveRun(t, { briefId, step: 'visual', inputHash: inputHash('visual', 'img', { n: 1, direction: 2 }), model: 'img' }, 2);
    expect(other).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('a chamada que falhou libera a vaga e pode ser tentada de novo', async () => {
    const t = tenantDb(A);
    const { rows } = await admin.query("select id, brief_id, input_hash from generation_runs where tenant_id = $1 and step = 'visual' order by created_at limit 1", [A]);
    await gen.failRun(t, rows[0].id, 'o modelo não respondeu', 90000);
    expect(await gen.monthlyUsage(t, 2)).toEqual({ used: 1, max: 2, remaining: 1 });
    const retry = await gen.reserveRun(t, { briefId: rows[0].brief_id, step: 'visual', inputHash: rows[0].input_hash, model: 'img' }, 2);
    expect(retry).toMatchObject({ ok: true, reused: false, run: { id: rows[0].id, status: 'reserved', error: null } });
    expect(await gen.monthlyUsage(t, 2)).toEqual({ used: 2, max: 2, remaining: 0 });
  });

  it('o plano inicial permite 20 por mês', async () => {
    expect((await admin.query("select max_posts_per_month from plans where id = 'inicial'")).rows[0].max_posts_per_month).toBe(20);
  });
});

describe('fatos da empresa', () => {
  it('cria, lista por conta, altera, apaga e audita sem o texto', async () => {
    const t = tenantDb(A);
    const fact = await facts.createFact(t, ANA, { kind: 'fact', text: 'Entrega no mesmo dia em Marília', source: 'site', source_note: 'site/entrega' });
    await facts.createFact(t, ANA, { kind: 'never', text: 'garantia de resultado', source: 'owner', source_note: null });
    await facts.createFact(tenantDb(B), ANA, { kind: 'fact', text: 'da outra conta', source: 'owner', source_note: null });
    expect((await facts.listFacts(t)).map((f) => f.text)).toEqual(['Entrega no mesmo dia em Marília', 'garantia de resultado']);

    await facts.updateFact(t, ANA, { id: fact.id, active: false, text: 'Entrega no dia em Marília' });
    expect((await facts.listFacts(t))[0]).toMatchObject({ text: 'Entrega no dia em Marília', active: false });
    await expect(facts.updateFact(tenantDb(B), ANA, { id: fact.id, active: true })).rejects.toThrow(/não encontrado/);

    await facts.deleteFact(t, ANA, fact.id);
    expect((await facts.listFacts(t)).map((f) => f.kind)).toEqual(['never']);
    const audit = (await admin.query("select action, metadata from audit_events where tenant_id = $1 and action like 'facts.%' order by created_at", [A])).rows;
    expect(audit.map((r) => r.action)).toEqual(['facts.created', 'facts.created', 'facts.updated', 'facts.deleted']);
    expect(JSON.stringify(audit)).not.toContain('Marília');
  });
});
