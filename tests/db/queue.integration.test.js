// Fila, publicados e rejeitados no Postgres (SPEC 010: o estado em YAML saiu).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.STATE_BACKEND = 'postgres';
process.env.TENANT_ID = 'pilar';

const admin = new pg.Pool({ connectionString: url, max: 1 });
const { getQueue, getPublished, getRejected, popNext, pushToQueue, markPublished, markRejected } = await import('../../src/utils/queue.js');
const { closeDb } = await import('../../src/utils/db.js');

beforeAll(() => resetTenantData(admin));
beforeEach(() => resetTenantData(admin));
afterAll(async () => {
  await resetTenantData(admin);
  await admin.end();
  await closeDb();
});

const DAY = 86400000;

describe('fila de ideias', () => {
  it('começa vazia', async () => {
    expect(await getQueue()).toEqual([]);
    expect(await popNext()).toBeNull();
  });

  it('enfileira, lê e consome na ordem', async () => {
    await pushToQueue({ pillar: 'dor', angle: 'tempo' });
    await pushToQueue({ pillar: 'dica' });
    expect((await getQueue()).map((i) => i.pillar)).toEqual(['dor', 'dica']);
    expect((await popNext()).pillar).toBe('dor');
    expect((await getQueue()).map((i) => i.pillar)).toEqual(['dica']);
  });

  it('pula item agendado para o futuro e aceita o que já venceu', async () => {
    await pushToQueue({ pillar: 'dor', scheduled_for: new Date(Date.now() + DAY).toISOString() });
    await pushToQueue({ pillar: 'dica' });
    expect((await popNext()).pillar).toBe('dica');
    expect(await popNext()).toBeNull();
    await pushToQueue({ pillar: 'prova', scheduled_for: new Date(Date.now() - DAY).toISOString() });
    expect((await popNext()).pillar).toBe('prova');
  });

  it('dois consumidores ao mesmo tempo não pegam o mesmo item', async () => {
    await pushToQueue({ pillar: 'dor' });
    const results = await Promise.all([popNext(), popNext(), popNext()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('publicados e rejeitados', () => {
  it('markPublished grava o post com carimbo e a escolha, e getPublished devolve em ordem cronológica', async () => {
    await markPublished({ pillar: 'dor', angle: 'tempo', post: { hook: 'a', body: 'b', format: 'single' } }, { chosenVariationId: 1, channels: { instagram: { id: '1' } } });
    await markPublished({ pillar: 'dica', post: { hook: 'c', body: 'd', format: 'single' } }, { chosenVariationId: 2, channels: { linkedin: { id: '2' } } });
    const published = await getPublished();
    expect(published.map((p) => p.pillar)).toEqual(['dor', 'dica']);
    expect(published[0].chosen_variation).toBe(1);
    expect(published[0].published_at).toBeDefined();
  });

  it('markRejected guarda o motivo, ou um texto padrão', async () => {
    await markRejected({ pillar: 'dor', post: { hook: 'x', body: 'y', format: 'single' } }, 'tom errado');
    await markRejected({ pillar: 'dica' });
    const rejected = await getRejected();
    expect(rejected.map((r) => r.reason)).toEqual(['tom errado', 'sem motivo informado']);
  });
});
