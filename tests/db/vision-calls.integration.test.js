// Teto diário por conta nas chamadas de visão contra o Postgres (BEZ-244, migration 0033): a reserva
// acima do teto não chama o modelo, a falha libera a vaga, duas reservas na última vaga não passam
// juntas, cada tipo tem o seu teto e cada conta o seu consumo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { withVisionBudget, reserveVision } = await import('../../platform/src/lib/vision-calls.ts');

const PLAN = 'it-vision';
const A = 'it-vis-a';
const B = 'it-vis-b';
const result = { json: {}, raw: '{}', inputTokens: 1200, outputTokens: 80, modelVersion: 'gemini-test', durationMs: 5, costUsd: 0.0006 };

let calls = 0;
const ok = async () => {
  calls += 1;
  return result;
};

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query(
    `insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_photo_captions_per_day, max_media_describes_per_day)
     values ($1, 'It Vision', 'empresa', 5, 1, 2, 1)
     on conflict (id) do update set max_photo_captions_per_day = 2, max_media_describes_per_day = 1`,
    [PLAN],
  );
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'empresa', $3), ($2, $2, 'empresa', $3)", [A, B, PLAN]);
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('teto diário de visão', () => {
  it('até o teto chama o modelo e grava tokens e custo; acima, devolve nulo sem chamar', async () => {
    const t = tenantDb(A);
    expect(await withVisionBudget(t, 'photo_caption', null, ok)).toBe(result);
    expect(await withVisionBudget(t, 'photo_caption', null, ok)).toBe(result);
    expect(await withVisionBudget(t, 'photo_caption', null, ok)).toBeNull();
    expect(calls).toBe(2);
    const rows = (await admin.query("select status, input_tokens, output_tokens, cost_usd::float as cost from vision_calls where tenant_id = $1 and kind = 'photo_caption'", [A])).rows;
    expect(rows).toEqual([
      { status: 'done', input_tokens: 1200, output_tokens: 80, cost: 0.0006 },
      { status: 'done', input_tokens: 1200, output_tokens: 80, cost: 0.0006 },
    ]);
  });

  it('cada tipo tem o seu teto, e falha do modelo libera a vaga', async () => {
    const t = tenantDb(A);
    await expect(withVisionBudget(t, 'media_describe', null, async () => { throw new Error('Vertex 503'); })).rejects.toThrow('Vertex 503');
    expect((await admin.query("select status, error from vision_calls where tenant_id = $1 and kind = 'media_describe'", [A])).rows).toEqual([{ status: 'failed', error: 'Vertex 503' }]);
    expect(await withVisionBudget(t, 'media_describe', null, ok)).toBe(result);
    expect(await withVisionBudget(t, 'media_describe', null, ok)).toBeNull();
  });

  it('outra conta tem o próprio teto', async () => {
    expect(await withVisionBudget(tenantDb(B), 'photo_caption', null, ok)).toBe(result);
  });

  it('duas reservas ao mesmo tempo na última vaga: só uma passa', async () => {
    const t = tenantDb(B);
    const [r1, r2] = await Promise.all([reserveVision(t, 'photo_caption', null), reserveVision(t, 'photo_caption', null)]);
    expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
  });

  it('o consumo de ontem não conta hoje', async () => {
    await admin.query("update vision_calls set created_at = now() - interval '2 days' where tenant_id = $1", [A]);
    expect(await withVisionBudget(tenantDb(A), 'photo_caption', null, ok)).toBe(result);
  });
});
