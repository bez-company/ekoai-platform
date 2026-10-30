// O job do estúdio contra o Postgres (SPEC 030 F3c): o pedido que o estúdio não entrega volta à fila como Rápido, e o que ele entrega
// vira pendência. Modelo e renderer falsos; nenhuma chamada paga.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { runStudioJob, jobInputFrom, heartbeat } = await import('../../platform/src/lib/studio/job.ts');
const { postProgress, listInProgress } = await import('../../platform/src/lib/post-requests.ts');
const { reserveRun } = await import('../../platform/src/lib/generation-db.ts');
const { inputHash } = await import('../../platform/src/lib/generation-model.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');

const A = 'it-job-a';
const ANA = { id: '00000000-0000-4000-8000-000000000a01', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const template = JSON.parse(readFileSync(join(import.meta.dirname, '../../platform/src/lib/studio/library/cartaz-tipografico-1.json'), 'utf8'));
const objects = new Map();
const store = { put: async (k, b, t) => void objects.set(k, { b, t }), get: async (k) => objects.get(k).b, remove: async () => undefined, removePrefix: async () => undefined };
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const FILL = JSON.stringify({ template: template.id, slots: { headline: 'Bolo bom não tem pressa', support: 'Três sinais de que o bolo está no ponto.' }, caption: 'O bolo está no ponto quando o palito sai limpo e a massa volta ao toque. Salve este post e confira na próxima fornada.', hashtags: ['#bolo'], altText: 'Cartaz', palette: { bg: '#B83262', ink: '#FFFFFF', accent: '#F2A9C4' }, imagePrompt: null });
const model = (script) => ({ costUsd: 0, costByStep: {}, async text() { const n = script.shift(); if (n instanceof Error) throw n; this.costUsd += 0.004; return n; }, async image() { throw new Error('sem imagem'); } });
const deps = (m, stages = []) => ({ modelFor: () => m, renderer: { render: async () => ({ png: PNG, issues: [], texts: [] }) }, library: [template], store, onStage: (s) => stages.push(s) });
const brief = async (effort) => (await one("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, effort) values ($1, 'dica', 'sinais do bolo', 'generating', 'platform', 'informativo', $2) returning id", [A, effort])).id;

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-job-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Job', 'empresa', 'inicial')", [A]);
  const t = tenantDb(A);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itjob' } });
});
afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('entrada do job', () => {
  it('lê STUDIO_TENANT e STUDIO_BRIEF e recusa o que falta ou não é uuid', () => {
    expect(jobInputFrom({ STUDIO_TENANT: 'acme', STUDIO_BRIEF: '123e4567-e89b-12d3-a456-426614174000' })).toEqual({ tenantId: 'acme', briefId: '123e4567-e89b-12d3-a456-426614174000' });
    expect(() => jobInputFrom({ STUDIO_TENANT: 'acme' })).toThrow();
    expect(() => jobInputFrom({ STUDIO_TENANT: 'acme', STUDIO_BRIEF: 'não-é-uuid' })).toThrow();
  });
});

describe('uma execução do job', () => {
  it('entrega o post: pendência em Aprovar e o pedido pronto', async () => {
    const t = tenantDb(A);
    const id = await brief('instantaneo');
    const out = await runStudioJob(t, { tenantId: A, briefId: id }, deps(model([FILL])));
    expect(out).toMatchObject({ status: 'ready' });
    expect((await one('select status, effort from briefs where id = $1', [id]))).toMatchObject({ status: 'ready', effort: 'instantaneo' });
  });

  it('o estúdio não entregou: o pedido volta à fila como Rápido, para o gerador de sempre', async () => {
    const t = tenantDb(A);
    const id = await brief('refinado');
    let woke = 0;
    const out = await runStudioJob(t, { tenantId: A, briefId: id }, deps(model([])), { wake: () => void (woke += 1) });
    expect(out).toMatchObject({ status: 'fallback' });
    expect(await one('select status, effort, fallback_from, fallback_reason from briefs where id = $1', [id])).toMatchObject({ status: 'queued', effort: 'instantaneo', fallback_from: 'refinado', fallback_reason: 'o estúdio não conseguiu concluir a peça' });
    // O worker é acordado: no staging sob demanda o Scheduler da geração fica pausado.
    expect(woke).toBe(1);
  });

  it('exceção dentro do estúdio também devolve o pedido à fila, nunca o deixa preso em geração', async () => {
    const t = tenantDb(A);
    const id = await brief('autoral');
    const boom = { ...deps(model([])), modelFor: () => { throw new Error('credencial vencida'); } };
    let woke = 0;
    const out = await runStudioJob(t, { tenantId: A, briefId: id }, boom, { wake: () => void (woke += 1) });
    expect(out).toMatchObject({ status: 'fallback' });
    expect(woke).toBe(1);
    expect(await one('select status, effort from briefs where id = $1', [id])).toMatchObject({ status: 'queued', effort: 'instantaneo' });
  });

  it('pedido já decidido por outro caminho não é mexido pelo requeue', async () => {
    const t = tenantDb(A);
    const id = await brief('refinado');
    await admin.query("update briefs set status = 'ready' where id = $1", [id]);
    await runStudioJob(t, { tenantId: A, briefId: id }, deps(model([])));
    expect((await one('select status from briefs where id = $1', [id])).status).toBe('ready');
  });
});

describe('andamento do estúdio na tela e em Aprovar (BEZ-496)', () => {
  it('o job grava a etapa na chamada render; o progresso e a lista em criação a mostram com o nível', async () => {
    const t = tenantDb(A);
    const id = await brief('refinado');
    await reserveRun(t, { briefId: id, step: 'render', inputHash: inputHash('render', 'studio', { effort: 'refinado', style: 'auto' }), model: 'studio' }, 20);
    expect((await postProgress(t, id))).toMatchObject({ effort: 'refinado', stage: null });
    await heartbeat(t, id, 'designer');
    expect(await postProgress(t, id)).toMatchObject({ effort: 'refinado', stage: 'designer', status: 'generating' });
    const list = await listInProgress(t);
    expect(list.find((p) => p.id === id)).toMatchObject({ effort: 'refinado', stage: 'designer' });
  });

  it('pedido pronto ou com falha não aparece em criação; o mais novo vem primeiro', async () => {
    const t = tenantDb(A);
    const done = await brief('refinado');
    await admin.query("update briefs set status = 'ready' where id = $1", [done]);
    const fresh = await brief('instantaneo', );
    const list = await listInProgress(t);
    expect(list.some((p) => p.id === done)).toBe(false);
    expect(list[0].id).toBe(fresh);
  });
});
