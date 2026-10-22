// Perguntas rápidas, horários padrão e o guia até a primeira publicação contra o Postgres
// (SPEC 017, BEZ-234; migration 0025).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testPool, testDb, resetTenantData } from './helpers.js';

const pool = testPool();
const client = testDb(pool);
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const data = await import('../../platform/src/lib/onboarding-data.ts');

const A = 'it-guide-a';
const B = 'it-guide-b';
const a = tenantDb(A, client);
const b = tenantDb(B, client);

const slotsOf = async (tenant) =>
  (await pool.query("select weekday, hour from publish_slots where tenant_id = $1 and channel = 'instagram' and active order by weekday", [tenant])).rows;

beforeAll(async () => {
  await resetTenantData(pool, [A, B]);
  await pool.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Guide A', B, 'It Guide B']);
});
afterAll(async () => {
  await resetTenantData(pool, [A, B]);
  await pool.end();
});

describe('respostas do onboarding', () => {
  it('conta nova não respondeu', async () => {
    expect(await data.getOnboardingAnswers(a)).toBeNull();
  });

  it('pular grava a linha só com nulos e não cria horário', async () => {
    expect(await data.saveOnboardingAnswers(b, null, { source: null, goal: null, postsPerWeek: null })).toEqual({ slotsCreated: 0 });
    expect(await data.getOnboardingAnswers(b)).toMatchObject({ source: null, goal: null, postsPerWeek: null });
    expect(await slotsOf(B)).toEqual([]);
  });

  it('3 por semana cria ter, qui e sáb às 18h; responder de novo sobrescreve e não duplica horário', async () => {
    expect(await data.saveOnboardingAnswers(a, null, { source: 'instagram', goal: 'vender_mais', postsPerWeek: 3 })).toEqual({ slotsCreated: 3 });
    expect(await slotsOf(A)).toEqual([{ weekday: 2, hour: 18 }, { weekday: 4, hour: 18 }, { weekday: 6, hour: 18 }]);
    expect(await data.saveOnboardingAnswers(a, null, { source: 'google', goal: null, postsPerWeek: 5 })).toEqual({ slotsCreated: 0 });
    expect(await data.getOnboardingAnswers(a)).toMatchObject({ source: 'google', goal: null, postsPerWeek: 5 });
    expect(await slotsOf(A)).toHaveLength(3);
  });

  it('cada conta tem a sua resposta', async () => {
    expect((await data.getOnboardingAnswers(b)).source).toBeNull();
  });

  it('o banco recusa resposta fora da lista', async () => {
    const err = await pool.query('update onboarding_answers set posts_per_week = 4 where tenant_id = $1', [A]).then(() => null, (e) => e);
    expect(err?.code).toBe('23514');
  });
});

describe('fatos do guia', () => {
  it('conta nova: nada feito e a publicação pausada (migration 0013)', async () => {
    const f = await data.guideFacts(b);
    expect(f).toMatchObject({ instagramConnected: false, postCreated: false, postApproved: false, hasSlots: false, paused: true, published: false, pendingSavedAt: [] });
  });

  it('pedido, aprovado, horário e publicado são lidos do dado real', async () => {
    await pool.query("insert into briefs (tenant_id, idea, source, status) values ($1, 'bolo de pote', 'platform', 'queued')", [B]);
    expect((await data.guideFacts(b)).postCreated).toBe(true);

    await pool.query(
      `insert into scheduled_posts (tenant_id, channel, variation, caption_final, status, scheduled_for)
       values ($1, 'instagram', '{}'::jsonb, 'legenda', 'scheduled', now() + interval '1 day')`,
      [B],
    );
    let f = await data.guideFacts(b);
    expect(f).toMatchObject({ postApproved: true, published: false });

    await pool.query("update scheduled_posts set status = 'published', published_at = now() where tenant_id = $1", [B]);
    await pool.query("update publishing_controls set paused = false where tenant_id = $1", [B]);
    f = await data.guideFacts(b);
    expect(f).toMatchObject({ published: true, paused: false });
    expect((await data.guideFacts(a)).hasSlots).toBe(true);
    expect((await data.guideFacts(a)).published).toBe(false);
  });
});
