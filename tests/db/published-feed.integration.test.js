// Publicados contra o Postgres (BEZ-238): a imagem e a legenda vêm do agendamento que publicou, as
// métricas da última coleta; post de outra conta e simulação (dry run) não aparecem.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { listPublished, getPublished, removePublished } = await import('../../platform/src/lib/published-feed.ts');

const A = 'it-published-a';
const B = 'it-published-b';
const ids = {};

async function post(tenant, key, { hook, publishedAt, dryRun = false, image = null, caption = null }) {
  let scheduledId = null;
  if (image || caption) {
    const s = await admin.query(
      `insert into scheduled_posts (tenant_id, channel, variation, caption_final, image_url, status, scheduled_for)
       values ($1, 'instagram', '{"id":1}', $2, $3, 'published', $4) returning id`,
      [tenant, caption ?? '', image, publishedAt],
    );
    scheduledId = s.rows[0].id;
  }
  const r = await admin.query(
    `insert into posts (tenant_id, pillar, channel, hook, body, is_dry_run, published_at, scheduled_post_id)
     values ($1, 'produto', 'instagram', $2, 'corpo', $3, $4, $5) returning id`,
    [tenant, hook, dryRun, publishedAt, scheduledId],
  );
  ids[key] = r.rows[0].id;
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await post(A, 'old', { hook: 'Antigo', publishedAt: '2026-10-01T12:00:00Z', image: '/api/media/a/old.png', caption: 'Legenda antiga\n\n#doceponto' });
  await post(A, 'new', { hook: null, publishedAt: '2026-10-20T12:00:00Z', image: '/api/media/a/new.png', caption: 'Bolo de pote toda sexta\n\n#doceponto' });
  await post(A, 'bare', { hook: 'Sem agendamento', publishedAt: '2026-10-10T12:00:00Z' });
  await post(A, 'dry', { hook: 'Simulação', publishedAt: '2026-10-21T12:00:00Z', dryRun: true });
  await post(B, 'other', { hook: 'De outra conta', publishedAt: '2026-10-21T12:00:00Z' });
  const snap = `insert into metrics_snapshots (tenant_id, post_id, channel, likes, comments, saves, shares, reach, captured_at) values ($1, $2, 'instagram', $3, 1, 1, 0, 100, $4)`;
  await admin.query(snap, [A, ids.new, 5, '2026-10-20T18:00:00Z']);
  await admin.query(snap, [A, ids.new, 9, '2026-10-21T18:00:00Z']);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('publicados', () => {
  it('lista da conta, do mais novo ao mais antigo, com imagem, legenda e a última métrica', async () => {
    const items = await listPublished(tenantDb(A));
    expect(items.map((i) => i.id)).toEqual([ids.new, ids.bare, ids.old]);
    const [newest, bare] = items;
    expect(newest).toMatchObject({ title: 'Bolo de pote toda sexta', imageUrl: '/api/media/a/new.png', caption: 'Bolo de pote toda sexta\n\n#doceponto' });
    expect(newest.metrics).toMatchObject({ likes: 9, reach: 100 });
    expect(newest.metrics.engagement).toBeCloseTo(0.11);
    expect(bare).toMatchObject({ title: 'Sem agendamento', imageUrl: null, caption: 'Sem agendamento\n\ncorpo', metrics: null });
  });

  it('tirar da lista esconde o post, não toca em outra conta e não repete', async () => {
    expect(await removePublished(tenantDb(B), ids.old)).toBe(false);
    expect((await listPublished(tenantDb(A))).map((i) => i.id)).toContain(ids.old);
    expect(await removePublished(tenantDb(A), ids.old)).toBe(true);
    expect((await listPublished(tenantDb(A))).map((i) => i.id)).toEqual([ids.new, ids.bare]);
    expect(await getPublished(tenantDb(A), ids.old)).toBeNull();
    expect(await removePublished(tenantDb(A), ids.old)).toBe(false);
    // a linha e o histórico ficam
    expect((await admin.query('select removed_at from posts where id = $1', [ids.old])).rows[0].removed_at).not.toBeNull();
  });

  it('o detalhe não abre post de outra conta nem simulação', async () => {
    expect((await getPublished(tenantDb(A), ids.bare)).title).toBe('Sem agendamento');
    expect(await getPublished(tenantDb(A), ids.other)).toBeNull();
    expect(await getPublished(tenantDb(A), ids.dry)).toBeNull();
  });
});
