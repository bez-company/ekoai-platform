// Painel do Início contra o Postgres (SPEC 017, decisão 3; BEZ-232): contagens, agendados da semana, o
// último publicado com as métricas e o próximo passo, sem misturar contas.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { homeSummary } = await import('../../platform/src/lib/home-summary.ts');

const H = 3_600_000;
const NOW = Date.parse('2026-10-22T12:00:00Z');
const at = (ms) => new Date(NOW + ms).toISOString();
const A = 'it-home-a';
const B = 'it-home-b';
const can = { approve: true, publishing: true, channels: true, create: true };

async function scheduled(tenant, status, scheduledFor, extra = {}) {
  const { rows } = await admin.query(
    `insert into scheduled_posts (tenant_id, channel, variation, caption_final, status, scheduled_for, image_url, published_at, post_id)
     values ($1, 'instagram', '{}'::jsonb, $2, $3, $4, $5, $6, $7) returning id`,
    [tenant, `legenda ${status}`, status, scheduledFor, extra.image ?? null, extra.publishedAt ?? null, extra.postId ?? null],
  );
  return rows[0].id;
}

let postId;

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await admin.query('update publishing_controls set paused = false where tenant_id = $1', [A]);
  await admin.query(
    `insert into social_accounts (id, tenant_id, channel, external_id, handle, status, scopes, expires_at, connected_at)
     values ('00000000-0000-4000-8000-0000000000d1', $1, 'instagram', '17841400000000091', 'doce_ponto', 'active', '{}', $2, now())`,
    [A, at(40 * 24 * H)],
  );
  await admin.query("insert into publish_slots (tenant_id, channel, weekday, hour, minute, active) values ($1, 'instagram', 2, 18, 0, true)", [A]);
  await scheduled(A, 'scheduled', at(30 * H), { image: 'https://example.test/a.png' });
  await scheduled(A, 'scheduled', at(2 * H));
  await scheduled(A, 'scheduled', at(9 * 24 * H)); // fora da semana
  await scheduled(A, 'queued', null);
  postId = (await admin.query("insert into posts (tenant_id, pillar, channel, channels, published_at) values ($1, 'post', 'instagram', '{}', $2) returning id", [A, at(-24 * H)])).rows[0].id;
  await scheduled(A, 'published', at(-24 * H), { publishedAt: at(-24 * H), postId });
  await scheduled(A, 'published', at(-48 * H), { publishedAt: at(-48 * H) });
  await admin.query("insert into metrics_snapshots (tenant_id, post_id, channel, likes, comments, reach, captured_at) values ($1, $2, 'instagram', 30, 4, 400, $3)", [A, postId, at(-H)]);
  await scheduled(B, 'failed', at(-H));
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('painel do Início', () => {
  it('conta A: contagens, a semana em ordem, o último publicado com métricas e fila como próximo passo', async () => {
    const s = await homeSummary(tenantDb(A), can, NOW);
    expect(s.counts).toEqual({ pending: 0, scheduled: 3, queued: 1, failed: 0 });
    expect(s.week.map((w) => w.scheduledFor)).toEqual([at(2 * H), at(30 * H)]);
    expect(s.week[1]).toMatchObject({ imageUrl: 'https://example.test/a.png', caption: 'legenda scheduled' });
    expect(s.lastPublished).toMatchObject({ postId, publishedAt: at(-24 * H), metrics: { likes: 30, comments: 4, reach: 400, engagement: 0.085 } });
    expect(s.next?.id).toBe('queued');
  });

  it('conta B: nada de A; sem Instagram conectado é o primeiro passo', async () => {
    const s = await homeSummary(tenantDb(B), can, NOW);
    expect(s.counts).toEqual({ pending: 0, scheduled: 0, queued: 0, failed: 1 });
    expect(s.week).toEqual([]);
    expect(s.lastPublished).toBeNull();
    expect(s.next?.id).toBe('instagram_connect');
  });
});
