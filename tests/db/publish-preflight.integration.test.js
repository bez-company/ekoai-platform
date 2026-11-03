// Conferência antes de publicar contra o Postgres (BEZ-275): o post foi aprovado e, antes de sair, o fato venceu, a
// campanha pausou ou a foto perdeu a autorização. O critério é 0 chamada à Meta para o post segurado, o post como
// "falhou" com o motivo e um aviso para a conta; no caminho da reconciliação, o container pronto não é publicado. A Meta
// é um dublê que só conta chamadas; o comportamento real dela não foi exercitado aqui.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

vi.mock('../../platform/src/lib/social-accounts.ts', async (orig) => ({ ...(await orig()), instagramCredentials: async () => ({ accountId: '1784', token: 'tok' }) }));

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { runPublishDue, publishNow, reconcileStalePublishing, LEASE_TTL_MS } = await import('../../platform/src/lib/publish.ts');
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { approvePending } = await import('../../platform/src/lib/scheduling.ts');
const A = 'it-preflight-a';

// ── Meta dublê: cria container pronto e publica; guarda o que publicou ──────────────────────────
let meta;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
async function fakeFetch(input, init) {
  const path = new URL(input.toString()).pathname.replace(/^\/v[\d.]+/, '');
  const method = init?.method ?? 'GET';
  if (method === 'POST' && path === '/1784/media') {
    meta.createCalls += 1;
    const id = `c${(meta.seq += 1)}`;
    meta.containers.set(id, 'FINISHED');
    return json({ id });
  }
  if (method === 'POST' && path === '/1784/media_publish') {
    meta.publishCalls += 1;
    const id = new URLSearchParams(String(init.body)).get('creation_id');
    meta.containers.set(id, 'PUBLISHED');
    return json({ id: `m${meta.publishCalls}` });
  }
  const container = path.slice(1);
  if (method === 'GET' && meta.containers.has(container)) return json({ status_code: meta.containers.get(container) });
  throw new Error(`chamada inesperada à Meta: ${method} ${path}`);
}

// ── Dados ──────────────────────────────────────────────────────────────────────────────────────
const day = (offset) => new Date(Date.now() + offset * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);

async function post({ caption = 'Bolo de pote por R$ 18 só esta semana', campaignId = null, briefId = null, mediaAssetId = null, extra = {} } = {}) {
  const cols = { status: 'scheduled', attempt_id: null, publishing_started_at: null, meta_container_id: null, ...extra };
  const { rows } = await admin.query(
    `insert into scheduled_posts (tenant_id, channel, variation, caption_final, image_url, status, scheduled_for, campaign_id, brief_id, media_asset_id, attempt_id, publishing_started_at, meta_container_id)
     values ($1, 'instagram', $2, $3, 'https://app.test/api/media/images/a.png', $4, now() - interval '1 minute', $5, $6, $7, $8, $9, $10) returning id`,
    [A, JSON.stringify({ id: 1, hook: 'Bolo de pote', body: 'Corpo', format: 'single' }), caption, cols.status, campaignId, briefId, mediaAssetId, cols.attempt_id, cols.publishing_started_at, cols.meta_container_id],
  );
  return rows[0].id;
}
const fact = (validUntil) =>
  admin.query("insert into company_facts (tenant_id, kind, text, status, verified_at, valid_until, category) values ($1, 'fact', 'Bolo de pote por R$ 18', 'confirmed', now(), $2, 'oferta_preco')", [A, validUntil]);
const campaign = async (status, endDate = null) =>
  (await admin.query("insert into campaigns (tenant_id, slug, name, status, end_date, confirmed_at) values ($1, $2, 'Semana do bolo', $3, $4, now()) returning id", [A, `c-${status}-${Math.random().toString(36).slice(2, 8)}`, status, endDate])).rows[0].id;
const photo = async (hasPeople, consent) =>
  (await admin.query("insert into media_assets (tenant_id, storage_path, content_type, byte_size, width, height, has_people, people_consent) values ($1, 'tenants/' || $1 || '/media/f.jpg', 'image/jpeg', 10, 1080, 1350, $2, $3) returning id", [A, hasPeople, consent])).rows[0].id;
const row = async (id) => (await admin.query('select status, attempts, last_error from scheduled_posts where id = $1', [id])).rows[0];
const notices = async () => (await admin.query('select kind, level, body from notifications where tenant_id = $1 order by id', [A])).rows;

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('insert into tenants (id, name) values ($1, $1)', [A]);
});
beforeEach(async () => {
  meta = { containers: new Map(), seq: 0, createCalls: 0, publishCalls: 0 };
  vi.stubGlobal('fetch', fakeFetch);
  for (const tb of ['publish_reconciliations', 'post_events', 'post_variants', 'posts', 'notifications', 'scheduled_posts', 'pending_approvals', 'company_facts', 'briefs', 'campaigns', 'media_assets', 'publishing_controls']) {
    await admin.query(`delete from ${tb} where tenant_id = $1`, [A]);
  }
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('conferência antes de publicar', () => {
  it('fato vigente, campanha ativa e foto autorizada: publica como antes', async () => {
    await fact(day(10));
    const id = await post({ campaignId: await campaign('active', day(10)), mediaAssetId: await photo(true, true) });
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 1, failed: 0 });
    expect(meta.publishCalls).toBe(1);
    expect((await row(id)).status).toBe('published');
  });

  it('o preço venceu depois da aprovação: não chama a Meta, o post falha com o motivo e a conta é avisada', async () => {
    await fact(day(-2));
    const id = await post();
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 0, failed: 1 });
    expect(meta.createCalls + meta.publishCalls).toBe(0);
    const r = await row(id);
    expect(r).toMatchObject({ status: 'failed', attempts: 0 });
    expect(r.last_error).toContain('vem de um fato vencido');
    expect(await notices()).toMatchObject([{ kind: 'publish.held', level: 'warning' }]);
  });

  it('a campanha do pedido foi pausada: segura mesmo sem campaign_id no agendado', async () => {
    await fact(null);
    const campaignId = await campaign('paused');
    const { rows } = await admin.query("insert into briefs (tenant_id, idea, campaign_id) values ($1, 'bolo', $2) returning id", [A, campaignId]);
    const id = await post({ briefId: rows[0].id });
    await runPublishDue();
    expect(meta.createCalls).toBe(0);
    expect((await row(id)).last_error).toContain('"Semana do bolo" está pausada');
  });

  it('a foto perdeu a autorização de uso de imagem: segura também no publicar agora', async () => {
    await fact(null);
    const id = await post({ mediaAssetId: await photo(true, false) });
    const res = await publishNow(tenantDb(A), id);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('autorização de uso de imagem');
    expect(meta.createCalls).toBe(0);
    expect((await row(id)).status).toBe('failed');
  });

  it('depois de corrigir, publicar agora sai', async () => {
    await fact(day(-2));
    const id = await post();
    await runPublishDue();
    await admin.query("update company_facts set valid_until = $2 where tenant_id = $1", [A, day(30)]);
    expect((await publishNow(tenantDb(A), id)).ok).toBe(true);
    expect(meta.publishCalls).toBe(1);
    expect((await row(id)).status).toBe('published');
  });

  it('reconciliação com container pronto e campanha encerrada: não publica o container e não trata como post preso', async () => {
    await fact(null);
    meta.containers.set('c99', 'FINISHED');
    const id = await post({
      campaignId: await campaign('active', day(-1)),
      extra: { status: 'publishing', attempt_id: '00000000-0000-4000-8000-0000000000bb', publishing_started_at: new Date(Date.now() - LEASE_TTL_MS - 60_000), meta_container_id: 'c99' },
    });
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, published: 0, failed: 1, errors: 0 });
    expect(meta.publishCalls).toBe(0);
    expect(meta.containers.get('c99')).toBe('FINISHED');
    expect((await row(id)).last_error).toContain('terminou em');
    const recs = (await admin.query('select found, action from publish_reconciliations where scheduled_post_id = $1', [id])).rows;
    expect(recs).toEqual([{ found: 'not_published', action: 'failed_for_review' }]);
    expect((await notices()).map((n) => n.kind)).toEqual(['publish.held']);
  });
});

// SPEC 035 (BEZ-543): a aprovação grava os fatos que o post afirma; a mudança depois dela segura o post.
describe('base da aprovação', () => {
  async function approved(caption) {
    await admin.query(
      `insert into pending_approvals (tenant_id, pending_id, channel, generation, images, post_kind)
       values ($1, 'p-base', 'instagram', $2, $3, 'informativo')`,
      [A, JSON.stringify({ variations: [{ id: 1, hook: 'Bolo de pote', body: 'Corpo' }] }), JSON.stringify([{ id: 1, url: 'https://app.test/api/media/images/a.png' }])],
    );
    const { id } = await approvePending(tenantDb(A), { pendingId: 'p-base', captionId: 1, artId: 1, captionText: caption, scheduledFor: new Date(Date.now() - 60_000).toISOString() });
    return id;
  }
  const factId = async () => (await admin.query('select id from company_facts where tenant_id = $1', [A])).rows[0].id;

  it('aprovar grava o fato que o post repete', async () => {
    await fact(null);
    const id = await approved('Bolo de pote por R$ 18 só esta semana');
    const { approval_basis } = (await admin.query('select approval_basis from scheduled_posts where id = $1', [id])).rows[0];
    expect(approval_basis).toMatchObject({ facts: [{ id: await factId(), text: 'Bolo de pote por R$ 18' }], campaign: null });
  });

  it('o preço foi editado depois da aprovação: não chama a Meta e diz o antes e o depois', async () => {
    await fact(null);
    const id = await approved('Bolo de pote por R$ 18 só esta semana');
    await admin.query("update company_facts set text = 'Bolo de pote por R$ 20' where tenant_id = $1", [A]);
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 0, failed: 1 });
    expect(meta.createCalls).toBe(0);
    expect((await row(id)).last_error).toContain('era "Bolo de pote por R$ 18", agora é "Bolo de pote por R$ 20"');
  });

  it('o fato foi desligado depois da aprovação: segura; sem mudança, publica', async () => {
    await fact(null);
    const held = await approved('Bolo de pote por R$ 18 só esta semana');
    await admin.query('update company_facts set active = false where tenant_id = $1', [A]);
    await runPublishDue();
    expect((await row(held)).last_error).toContain('foi desligado');
    await admin.query('update company_facts set active = true where tenant_id = $1', [A]);
    expect((await publishNow(tenantDb(A), held)).ok).toBe(true);
    expect(meta.publishCalls).toBe(1);
  });
});
