// O worker de geração e o job do estúdio (SPEC 030 F3c): o pedido de nível alto vai para o job e segue "em geração"; sem job, pedido
// parado de antes ou disparo que falha, ele vira Rápido e sai pelo caminho de sempre. Nenhuma chamada de rede.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 4 });
const worker = await import('../../platform/src/lib/generation-worker.ts');

const A = 'it-worker-a';
const JOB = 'projects/ekoai-staging/locations/southamerica-east1/jobs/ekoai-studio';
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const brief = async (effort, status = 'queued') => (await one("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, effort) values ($1, 'dica', 'ideia', $2, 'platform', 'informativo', $3) returning id", [A, status, effort])).id;
// Modelo que falha: o que interessa aqui é o roteamento, não o post.
const brokenModel = { config: { project: 'p', location: 'global', textModel: 't', imageModel: 'i' }, async generateJson() { throw new Error('sem modelo no teste'); }, async generateImage() { throw new Error('sem modelo no teste'); } };
const okFetch = (calls) => async (u, init) => (calls.push({ u, body: JSON.parse(init.body) }), new Response('{}', { status: 200 }));

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Worker', 'empresa', 'inicial')", [A]);
});
afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('roteamento do worker', () => {
  it('Refinado vai para o job do estúdio e o pedido segue em geração', async () => {
    const id = await brief('refinado');
    const calls = [];
    const summary = await worker.runGenerateQueue({ model: brokenModel }, { limit: 5, studio: { jobName: JOB, fetchImpl: okFetch(calls), token: async () => 't' } });
    expect(summary.dispatched).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.overrides.containerOverrides[0].env).toContainEqual({ name: 'STUDIO_BRIEF', value: id });
    expect(await one('select status, effort from briefs where id = $1', [id])).toMatchObject({ status: 'generating', effort: 'refinado' });
  });

  it('sem job configurado, o pedido vira Rápido e sai pelo caminho de sempre', async () => {
    const id = await brief('autoral');
    const calls = [];
    const summary = await worker.runGenerateQueue({ model: brokenModel }, { limit: 5, studio: { jobName: null, fetchImpl: okFetch(calls) } });
    expect(summary.dispatched).toBe(0);
    expect(calls).toHaveLength(0);
    expect(await one('select effort, fallback_from, fallback_reason from briefs where id = $1', [id])).toEqual({ effort: 'instantaneo', fallback_from: 'autoral', fallback_reason: 'o estúdio não está disponível agora' });
  });

  it('disparo que falha também cai no caminho de sempre', async () => {
    const id = await brief('refinado');
    const fetchImpl = async () => new Response('negado', { status: 403 });
    const summary = await worker.runGenerateQueue({ model: brokenModel }, { limit: 5, studio: { jobName: JOB, fetchImpl, token: async () => 't' } });
    expect(summary.dispatched).toBe(0);
    expect((await one('select effort from briefs where id = $1', [id])).effort).toBe('instantaneo');
  });

  it('pedido parado em geração (o job caiu) não volta ao estúdio: sai como Rápido', async () => {
    const id = await brief('refinado', 'generating');
    // O gatilho do banco refresca updated_at em todo update: some com ele só nesta conexão para envelhecer o pedido.
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      await c.query("update briefs set updated_at = now() - interval '30 minutes' where id = $1", [id]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const calls = [];
    const summary = await worker.runGenerateQueue({ model: brokenModel }, { limit: 5, studio: { jobName: JOB, fetchImpl: okFetch(calls), token: async () => 't' } });
    expect(calls).toHaveLength(0);
    expect(summary.dispatched).toBe(0);
    expect((await one('select effort from briefs where id = $1', [id])).effort).toBe('instantaneo');
  });

  it('Rápido não passa pelo job', async () => {
    await brief('instantaneo');
    const calls = [];
    const summary = await worker.runGenerateQueue({ model: brokenModel }, { limit: 5, studio: { jobName: JOB, fetchImpl: okFetch(calls), token: async () => 't' } });
    expect(calls).toHaveLength(0);
    expect(summary.dispatched).toBe(0);
  });
});
