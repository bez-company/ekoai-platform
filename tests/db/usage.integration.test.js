// O uso do mês contra o Postgres (SPEC 031, BEZ-456): posts são pedidos prontos, publicações vêm por rede, imagens são as geradas por
// modelo, ajustes são versões de design editadas e consertos do avaliador, e uma conta nunca vê o uso de outra. O mês é o de UTC.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { monthUsage } = await import('../../platform/src/lib/usage.ts');

const A = 'it-usage-a';
const B = 'it-usage-b';
const NOW = new Date('2026-10-29T12:00:00Z');
const USER = '00000000-0000-4000-8000-000000000751';

let n = 0;
const hash = () => String(++n).padStart(64, '0');
const brief = async (tenant, status, at) => (await admin.query("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, created_at) values ($1, 'dica', 'ideia', $2, 'platform', 'informativo', $3) returning id", [tenant, status, at])).rows[0].id;
const run = (tenant, briefId, step, status, at, images = null) =>
  admin.query('insert into generation_runs (tenant_id, brief_id, step, input_hash, status, images, created_at) values ($1, $2, $3, $4, $5, $6, $7)', [tenant, briefId, step, hash(), status, images ?? 0, at]);
const published = (tenant, channel, at, status = 'published') =>
  admin.query("insert into scheduled_posts (id, tenant_id, channel, variation, caption_final, status, scheduled_for, published_at) values (gen_random_uuid(), $1, $2, '{}'::jsonb, 'x', $3, $4, $4)", [tenant, channel, status, at]);

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-usage@example.test', 'Ana') on conflict (id) do nothing", [USER]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [A, USER]);

  // Outubro de 2026 na conta A
  const ready = await brief(A, 'ready', '2026-10-05T12:00:00Z');
  const approved = await brief(A, 'approved', '2026-10-31T23:59:59Z'); // último segundo do mês
  await brief(A, 'failed', '2026-10-06T12:00:00Z'); // não é post
  await brief(A, 'queued', '2026-10-07T12:00:00Z'); // ainda não é post
  await brief(A, 'ready', '2026-11-01T00:00:00Z'); // primeiro instante de novembro
  await brief(A, 'ready', '2026-09-30T23:59:59Z'); // setembro
  await run(A, ready, 'visual', 'done', '2026-10-05T12:01:00Z', 1);
  await run(A, approved, 'visual', 'done', '2026-10-31T23:59:59Z', 2);
  await run(A, ready, 'visual', 'failed', '2026-10-05T12:02:00Z', 1); // falha não gerou imagem
  await run(A, ready, 'fix', 'done', '2026-10-05T12:03:00Z');
  await run(A, ready, 'fix', 'failed', '2026-10-05T12:04:00Z'); // conserto que falhou não é ajuste
  await run(A, ready, 'critic', 'done', '2026-10-05T12:05:00Z'); // avaliar não é ajuste
  await published(A, 'instagram', '2026-10-06T10:00:00Z');
  await published(A, 'instagram', '2026-10-07T10:00:00Z');
  await published(A, 'linkedin', '2026-10-08T10:00:00Z');
  await published(A, 'twitter', '2026-10-09T10:00:00Z');
  await published(A, 'instagram', '2026-10-10T10:00:00Z', 'failed'); // falhou: não publicou
  await published(A, 'instagram', '2026-09-30T23:00:00Z'); // setembro
  const design = (await admin.query("insert into post_designs (tenant_id, brief_id, kind, layout, design) values ($1, $2, 'informativo', 'estrutura', '{}') returning id", [A, ready])).rows[0].id;
  const rev = (version, parent, source, at) => admin.query("insert into post_design_revisions (tenant_id, post_design_id, version, parent_version, source, design, diff, summary, created_at) values ($1, $2, $3, $4, $5, '{}', '[]', 'x', $6)", [A, design, version, parent, source, at]);
  await rev(1, null, 'initial', '2026-10-05T12:00:00Z'); // a geração não é ajuste
  await rev(2, 1, 'edit', '2026-10-12T12:00:00Z');
  await rev(3, 2, 'layout', '2026-10-13T12:00:00Z');
  await rev(4, 3, 'restore', '2026-09-20T12:00:00Z'); // setembro

  // A conta B tem o seu uso, que nunca aparece na A
  const other = await brief(B, 'ready', '2026-10-05T12:00:00Z');
  await run(B, other, 'visual', 'done', '2026-10-05T12:01:00Z', 5);
  await published(B, 'instagram', '2026-10-06T10:00:00Z');
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('uso do mês', () => {
  it('conta posts prontos e aprovados, publicações por rede, imagens geradas e ajustes do mês', async () => {
    const u = await monthUsage(tenantDb(A), '2026-10', NOW);
    expect(u).toEqual({ month: '2026-10', isCurrent: true, posts: 2, publications: { instagram: 2, linkedin: 1, twitter: 1 }, images: 3, adjustments: 3, people: 1 });
  });

  it('o limite do mês é [1º 00:00, 1º do seguinte 00:00) em UTC: o último segundo de outubro é de outubro e o primeiro de novembro não', async () => {
    const nov = await monthUsage(tenantDb(A), '2026-11', NOW);
    expect(nov.posts).toBe(1);
    expect(nov.images).toBe(0);
    const sep = await monthUsage(tenantDb(A), '2026-09', NOW);
    expect(sep).toMatchObject({ isCurrent: false, posts: 1, publications: { instagram: 1, linkedin: 0, twitter: 0 }, adjustments: 1, people: null });
  });

  it('a conta B vê só o dela, e mês sem nada vem zerado', async () => {
    expect(await monthUsage(tenantDb(B), '2026-10', NOW)).toMatchObject({ posts: 1, images: 5, adjustments: 0, publications: { instagram: 1, linkedin: 0, twitter: 0 } });
    const empty = await monthUsage(tenantDb(A), '2026-06', NOW);
    expect(empty).toMatchObject({ posts: 0, images: 0, adjustments: 0, publications: { instagram: 0, linkedin: 0, twitter: 0 } });
  });

  it('ajuste e conserto não viram post: o número de posts não muda com eles', async () => {
    const before = (await monthUsage(tenantDb(A), '2026-10', NOW)).posts;
    await admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, status, created_at) select tenant_id, id, 'fix', repeat('f', 64), 'done', '2026-10-15T10:00:00Z' from briefs where tenant_id = $1 limit 1", [A]);
    const after = await monthUsage(tenantDb(A), '2026-10', NOW);
    expect(after.posts).toBe(before);
    expect(after.adjustments).toBe(4);
  });
});
