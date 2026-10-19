// Os módulos de verdade (jobs da raiz e libs da plataforma) contra um Postgres com as
// migrations aplicadas: o que o supabase-js fazia por baixo tem que continuar valendo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.STATE_BACKEND = 'postgres';
process.env.TENANT_ID = 'pilar';

const admin = new pg.Pool({ connectionString: url, max: 2 });
const TENANTS = ['it-a', 'it-b'];
const JOB_TENANT = 'pilar'; // o único perfil de tenant que os jobs conhecem (src/tenant.js)

const queue = await import('../../src/utils/queue.js');
const { notify } = await import('../../src/utils/notifications.js');
const { createBrief, markBrief } = await import('../../src/utils/brief.js');
const { syncCampaigns } = await import('../../src/utils/campaign-sync.js');
const { getRecentFeedback } = await import('../../src/utils/feedback.js');
const { getActiveStyleRules } = await import('../../src/utils/reflections.js');
const { closeDb } = await import('../../src/utils/db.js');

const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const accounts = await import('../../platform/src/lib/accounts.ts');
const pause = await import('../../platform/src/lib/pause.ts');
const slots = await import('../../platform/src/lib/slots.ts');
const queries = await import('../../platform/src/lib/queries.ts');
const { exportTenant } = await import('../../platform/src/lib/export.ts');
const platformNotifications = await import('../../platform/src/lib/notifications.ts');

beforeAll(async () => {
  await cleanup();
  for (const id of TENANTS) await admin.query('insert into tenants (id, name) values ($1, $1)', [id]);
});

afterAll(async () => {
  await cleanup();
  await admin.end();
  await closeDb();
});

const cleanup = () => resetTenantData(admin, TENANTS);

describe('jobs da raiz', () => {
  it('fila: enfileira, consome uma vez e respeita agendamento futuro', async () => {
    await queue.pushToQueue({ pillar: 'dor', angle: 'a1', channels: ['instagram', 'linkedin'] });
    await queue.pushToQueue({ pillar: 'dica', scheduled_for: new Date(Date.now() + 3600_000).toISOString() });
    const first = await queue.popNext();
    expect(first).toMatchObject({ pillar: 'dor', angle: 'a1', channels: ['instagram', 'linkedin'] });
    expect(await queue.popNext()).toBeNull();
    const later = await queue.popNext(Date.now() + 2 * 3600_000);
    expect(later.pillar).toBe('dica');
  });

  it('pendência: salva (upsert por canal), espia, consome e expira', async () => {
    const base = { channel: 'instagram', pending_id: 'ig-1', generation: { variations: [] }, images: [{ id: 'a', url: 'https://x/y.png' }], seed: { pillar: 'dor' } };
    await queue.savePending(base);
    await queue.savePending({ ...base, pending_id: 'ig-2' });
    expect(await queue.getPending()).toHaveLength(1);
    const peek = await queue.loadPending('instagram', { peek: true });
    expect(peek.pending_id).toBe('ig-2');
    expect(peek.images).toEqual([{ id: 'a', url: 'https://x/y.png' }]);
    expect((await queue.loadPending('instagram')).pending_id).toBe('ig-2');
    expect(await queue.loadPending('instagram')).toBeNull();

    await queue.savePending(base);
    await admin.query("update pending_approvals set saved_at = now() - interval '8 days' where tenant_id = 'pilar'");
    const expired = await queue.expirePending();
    expect(expired.map((e) => e.channel)).toEqual(['instagram']);
    expect(await queue.getPending()).toEqual([]);
  });

  it('publicado e rejeitado: grava post, variações e eventos; histórico volta mapeado', async () => {
    await queue.markPublished(
      { pillar: 'dor', angle: 'a1', post: { hook: 'gancho', body: 'corpo', format: 'single' }, generated_at: new Date().toISOString() },
      {
        chosenVariationId: 1,
        channels: { instagram: { id: '123' } },
        generation: { variations: [{ id: 1, hook: 'h', body: 'b', format: 'single' }, { id: 2, hook: 'h2', body: 'b2', format: 'single' }], heuristic_scores: { 1: 0.8 }, judge_scores: [{ id: 1, expected_engagement: 0.3 }], model: 'm', prompt_hash: 'hh' },
      },
    );
    await queue.markRejected({ pillar: 'dica', post: { hook: 'x', body: 'y', format: 'single' }, channel: 'instagram' }, 'fraco');
    const published = await queue.getPublished();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ pillar: 'dor', post: { hook: 'gancho' }, chosen_variation: 1, channels: { instagram: { id: '123' } } });
    expect(typeof published[0].published_at).toBe('string');
    const { rows: variants } = await admin.query("select count(*)::int n from post_variants where tenant_id = 'pilar'");
    expect(variants[0].n).toBe(2);
    const { rows: events } = await admin.query("select type from post_events where tenant_id = 'pilar' order by type");
    expect(events.map((e) => e.type)).toEqual(['judge_decision', 'published']);
  });

  it('aviso, brief, campanhas, feedback e regras de estilo', async () => {
    expect(await notify({ kind: 'publish.ok', title: 'ok', link: '/history' }, { tenantId: JOB_TENANT })).toEqual({ stored: true });
    const briefId = await createBrief({ tenantId: JOB_TENANT, pillar: 'dor', angle: 'a', idea: 'ideia' });
    expect(briefId).toMatch(/^[0-9a-f-]{36}$/);
    await markBrief(briefId, 'done');
    const { rows } = await admin.query('select status from briefs where id = $1', [briefId]);
    expect(rows[0].status).toBe('done');

    const n = await syncCampaigns({ tenantId: JOB_TENANT, campaigns: [{ name: 'Lançamento', start: '2026-10-01', end: '2026-10-31', pillar: 'dor' }] });
    expect(n).toBe(1);
    await syncCampaigns({ tenantId: JOB_TENANT, campaigns: [{ name: 'Lançamento', start: '2026-10-02', end: '2026-10-31', pillar: 'dor' }] });
    const { rows: camps } = await admin.query("select start_date::text d from campaigns where tenant_id = 'pilar'");
    expect(camps).toEqual([{ d: '2026-10-02' }]);

    expect(await getRecentFeedback(JOB_TENANT, { channel: 'instagram' })).toEqual([]);
    expect(await getActiveStyleRules(JOB_TENANT, { channel: 'instagram' })).toEqual([]);
  });
});

describe('plataforma', () => {
  const a = tenantDb('it-a');
  const b = tenantDb('it-b');

  it('pausa por conta: upsert, leitura e isolamento entre tenants', async () => {
    // Conta nova nasce pausada (trigger da 0013).
    expect((await pause.getPauseState(a)).paused).toBe(true);
    await pause.setPause(a, false);
    expect((await pause.getPauseState(a)).paused).toBe(false);
    expect((await pause.getPauseState(b)).paused).toBe(true);
    await pause.setPause(a, true, 'revisão');
    expect(await pause.getPauseState(a)).toMatchObject({ paused: true, reason: 'revisão' });
  });

  it('grade de horários: cria, lista e remove', async () => {
    await slots.addSlot(a, { channel: 'instagram', weekday: 2, hour: 9, minute: 0 });
    const list = await slots.getActiveSlots(a, 'instagram');
    expect(list).toHaveLength(1);
    expect(await slots.getActiveSlots(b, 'instagram')).toEqual([]);
    await slots.removeSlot(a, list[0].id);
    expect(await slots.getActiveSlots(a)).toEqual([]);
  });

  it('consultas da tela: histórico, contagens e campanha ativa', async () => {
    const history = await queries.getPublishedHistory(a);
    expect(history.length).toBeGreaterThanOrEqual(0);
    expect(await queries.countByStatus(a)).toBeTypeOf('object');
    expect(await queries.getPendings(a)).toEqual([]);
    expect(await queries.getScheduled(a, ['scheduled'])).toEqual([]);
    const campaign = await queries.getActiveCampaign(a, '2026-10-10');
    expect(campaign === null || typeof campaign === 'object').toBe(true);
  });

  it('aviso da plataforma e export de todas as tabelas do tenant', async () => {
    const pilar = tenantDb(JOB_TENANT);
    await platformNotifications.notify(pilar, { kind: 'publish.ok', level: 'info', title: 'Publicado', link: '/history' });
    const dump = await exportTenant(pilar);
    expect(dump.tenant).toBe(JOB_TENANT);
    expect(dump.tables.notifications.length).toBeGreaterThan(0);
    expect(dump.tables.posts.length).toBe(1);
    expect(Object.keys(dump.tables).length).toBeGreaterThan(10);
  });

  it('pessoa: cria por login, liga por e-mail de convite e acha por id do provedor', async () => {
    await admin.query("insert into users (email) values ('it-convite@example.test')");
    const linked = await accounts.findOrLinkUser({ uid: 'idp-1', email: 'it-convite@example.test', emailVerified: true, signInAt: Date.now(), mfa: false });
    const again = await accounts.findOrLinkUser({ uid: 'idp-1', email: 'it-convite@example.test', emailVerified: true, signInAt: Date.now(), mfa: false });
    expect(again.id).toBe(linked.id);
    const created = await accounts.findOrLinkUser({ uid: 'idp-2', email: 'it-novo@example.test', emailVerified: true, signInAt: Date.now(), mfa: false });
    expect(created.id).not.toBe(linked.id);

    await admin.query("insert into tenant_members (tenant_id, user_id, role) values ('it-a', $1, 'creator')", [linked.id]);
    expect(await accounts.membershipsOf(linked.id)).toEqual([expect.objectContaining({ tenantId: 'it-a', role: 'creator' })]);
    expect(await accounts.roleIn(linked.id, 'it-a')).toBe('creator');
    expect(await accounts.roleIn(linked.id, 'it-b')).toBeNull();
    expect(await accounts.hasPermission('creator', 'it-a', 'content.edit')).toBe(true);
    expect(await accounts.hasPermission('viewer', 'it-a', 'content.approve')).toBe(false);

    await accounts.markLogin(linked.id, 'it-a');
    const user = await accounts.sessionUser(linked.id);
    expect(user.lastTenantId).toBe('it-a');
    const before = user.sessionVersion;
    await accounts.bumpSessionVersion(user);
    expect((await accounts.sessionUser(linked.id)).sessionVersion).toBe(before + 1);
  });
});
