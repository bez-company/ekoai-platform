// A lista de posts do mês e o detalhe de um post contra o Postgres (SPEC 031, entrega 2): uma ideia em duas redes é uma linha, o estado
// vem das publicações e das pendências, e uma conta nunca vê o post de outra.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { monthPosts, postActivity } = await import('../../platform/src/lib/usage-posts.ts');

const A = 'it-uposts-a';
const B = 'it-uposts-b';
let n = 0;
const hash = () => String(++n).padStart(64, '0');
const brief = async (tenant, idea, status, at, channels = '{instagram}') => (await admin.query("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, channels, created_at) values ($1, 'dica', $2, $3, 'platform', 'informativo', $4, $5) returning id", [tenant, idea, status, channels, at])).rows[0].id;
const sched = (tenant, briefId, channel, status) => admin.query("insert into scheduled_posts (id, tenant_id, channel, variation, caption_final, status, scheduled_for, brief_id) values (gen_random_uuid(), $1, $2, '{}'::jsonb, 'x', $3, now(), $4)", [tenant, channel, status, briefId]);
const pending = (tenant, briefId, channel) => admin.query("insert into pending_approvals (tenant_id, pending_id, channel, generation, images, post_kind, brief_id) values ($1, $2, $3, '{}', '[]', 'informativo', $4)", [tenant, `plat-${hash()}`, channel, briefId]);
const run = (tenant, briefId, step, channel, images = 0) => admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, status, channel, images) values ($1, $2, $3, $4, 'done', $5, $6)", [tenant, briefId, step, hash(), channel, images]);

let multi;
let other;
beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  multi = await brief(A, '3 sinais de que o seu bolo está pronto', 'approved', '2026-10-28T12:00:00Z', '{instagram,linkedin,twitter}');
  await sched(A, multi, 'instagram', 'published');
  await sched(A, multi, 'linkedin', 'published');
  await sched(A, multi, 'twitter', 'failed');
  await run(A, multi, 'writer', 'instagram');
  await run(A, multi, 'visual', 'instagram', 2);
  await run(A, multi, 'critic', 'instagram');
  await run(A, multi, 'critic', 'linkedin');
  await run(A, multi, 'fix', 'instagram');
  await run(A, multi, 'fix', 'linkedin');
  const design = (await admin.query("insert into post_designs (tenant_id, brief_id, kind, layout, design) values ($1, $2, 'informativo', 'estrutura', '{}') returning id", [A, multi])).rows[0].id;
  const rev = (v, parent, source) => admin.query("insert into post_design_revisions (tenant_id, post_design_id, version, parent_version, source, design, diff, summary) values ($1, $2, $3, $4, $5, '{}', '[]', 'x')", [A, design, v, parent, source]);
  await rev(1, null, 'initial');
  await rev(2, 1, 'edit');
  await rev(3, 2, 'layout');

  const scheduledOnly = await brief(A, 'Entrega no mesmo dia', 'ready', '2026-10-27T12:00:00Z');
  await sched(A, scheduledOnly, 'instagram', 'scheduled');
  const waiting = await brief(A, 'Aviso do feriado', 'ready', '2026-10-26T12:00:00Z', '{instagram,linkedin}');
  await pending(A, waiting, 'instagram');
  await pending(A, waiting, 'linkedin');
  await brief(A, 'Pedido recusado', 'ready', '2026-10-25T12:00:00Z', '{linkedin}');
  await brief(A, 'Pedido que falhou', 'failed', '2026-10-24T12:00:00Z');
  await brief(A, 'Pedido de setembro', 'ready', '2026-09-20T12:00:00Z');

  other = await brief(B, 'Post da outra conta', 'ready', '2026-10-28T12:00:00Z');
  await sched(B, other, 'instagram', 'published');
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('lista de posts do mês', () => {
  it('uma ideia em três redes é uma linha, do mais novo ao mais antigo, com redes na ordem do sistema e o estado certo', async () => {
    const list = await monthPosts(tenantDb(A), '2026-10');
    expect(list.total).toBe(4);
    expect(list.rows.map((r) => [r.title, r.channels, r.state])).toEqual([
      ['3 sinais de que o seu bolo está pronto', ['instagram', 'linkedin', 'twitter'], 'published'],
      ['Entrega no mesmo dia', ['instagram'], 'scheduled'],
      ['Aviso do feriado', ['instagram', 'linkedin'], 'to_approve'],
      ['Pedido recusado', ['linkedin'], 'none'],
    ]);
  });

  it('pedido que falhou ou de outro mês não entra, e o teto mostra o total real', async () => {
    const limited = await monthPosts(tenantDb(A), '2026-10', 2);
    expect(limited.rows).toHaveLength(2);
    expect(limited.total).toBe(4);
    expect((await monthPosts(tenantDb(A), '2026-09')).rows.map((r) => r.title)).toEqual(['Pedido de setembro']);
    expect(await monthPosts(tenantDb(A), '2026-06')).toEqual({ total: 0, rows: [] });
  });

  it('a conta B vê só o dela', async () => {
    const list = await monthPosts(tenantDb(B), '2026-10');
    expect(list.rows.map((r) => r.title)).toEqual(['Post da outra conta']);
  });
});

describe('detalhe de um post', () => {
  it('conta imagens geradas, avaliações por rede, consertos e ajustes de design, sem contar a geração', async () => {
    const a = await postActivity(tenantDb(A), multi);
    expect(a).toMatchObject({ title: '3 sinais de que o seu bolo está pronto', channels: ['instagram', 'linkedin', 'twitter'], state: 'published', generatedImages: 2, evaluated: ['instagram', 'linkedin'], designEdits: 2, fixes: 2 });
    expect(a.publications).toHaveLength(3);
  });

  it('post de outra conta, pedido que falhou e id que não existe são "não encontrado"', async () => {
    expect(await postActivity(tenantDb(A), other)).toBeNull();
    expect(await postActivity(tenantDb(B), multi)).toBeNull();
    const failed = (await admin.query("select id from briefs where tenant_id = $1 and status = 'failed'", [A])).rows[0].id;
    expect(await postActivity(tenantDb(A), failed)).toBeNull();
    expect(await postActivity(tenantDb(A), '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
