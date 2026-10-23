// Os módulos de verdade (jobs da raiz e libs da plataforma) contra um Postgres com as
// migrations aplicadas: o que o supabase-js fazia por baixo tem que continuar valendo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.STATE_BACKEND = 'postgres';
process.env.TENANT_ID = 'it-job';

const admin = new pg.Pool({ connectionString: url, max: 2 });
const JOB_TENANT = 'it-job'; // a conta do job (TENANT_ID), como no Cloud Run
const TENANTS = ['it-a', 'it-b', JOB_TENANT];

const queue = await import('../../src/utils/queue.js');
const { notify } = await import('../../src/utils/notifications.js');
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

  it('pendência: salva (várias por rede, upsert por id), espia, consome e expira', async () => {
    const base = { channel: 'instagram', pending_id: 'ig-1', generation: { variations: [] }, images: [{ id: 'a', url: 'https://x/y.png' }], seed: { pillar: 'dor' } };
    await queue.savePending(base);
    await queue.savePending({ ...base, pending_id: 'ig-2' });
    await queue.savePending({ ...base, pending_id: 'ig-2', seed: { pillar: 'dica' } });
    expect(await queue.getPending()).toHaveLength(2);
    const peek = await queue.loadPending('instagram', { peek: true });
    expect(peek.pending_id).toBe('ig-2');
    expect(peek.seed).toEqual({ pillar: 'dica' });
    expect(peek.images).toEqual([{ id: 'a', url: 'https://x/y.png' }]);
    expect((await queue.loadPending('instagram')).pending_id).toBe('ig-2');
    expect((await queue.loadPending('instagram')).pending_id).toBe('ig-1');
    expect(await queue.loadPending('instagram')).toBeNull();

    await queue.savePending(base);
    await admin.query("update pending_approvals set saved_at = now() - interval '8 days' where tenant_id = $1", [JOB_TENANT]);
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
    const { rows: variants } = await admin.query("select count(*)::int n from post_variants where tenant_id = $1", [JOB_TENANT]);
    expect(variants[0].n).toBe(2);
    const { rows: events } = await admin.query("select type from post_events where tenant_id = $1 order by type", [JOB_TENANT]);
    expect(events.map((e) => e.type)).toEqual(['judge_decision', 'published']);
  });

  it('aviso do job grava na conta do TENANT_ID', async () => {
    expect(await notify({ kind: 'publish.ok', title: 'ok', link: '/historico' })).toEqual({ stored: true });
    const { rows } = await admin.query('select count(*)::int n from notifications where tenant_id = $1', [JOB_TENANT]);
    expect(rows[0].n).toBe(1);
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
    const job = tenantDb(JOB_TENANT);
    await platformNotifications.notify(job, { kind: 'publish.ok', level: 'info', title: 'Publicado', link: '/historico' });
    const dump = await exportTenant(job);
    expect(dump.tenant).toBe(JOB_TENANT);
    expect(dump.tables.notifications.length).toBeGreaterThan(0);
    expect(dump.tables.posts.length).toBe(1);
    expect(Object.keys(dump.tables).length).toBeGreaterThan(10);
  });

  it('exportação leva perfil, convites e redes, e nunca o token nem o hash do convite', async () => {
    await admin.query(
      "insert into company_profiles (tenant_id, niche, offering, audience) values ($1, 'Alimentação', 'Bolos', 'Famílias')", [JOB_TENANT]);
    await admin.query(
      "insert into invitations (tenant_id, email, role, token_hash) values ($1, 'novo@example.test', 'viewer', repeat('a', 64))", [JOB_TENANT]);
    const { rows: [acct] } = await admin.query(
      "insert into social_accounts (tenant_id, channel, external_id, handle) values ($1, 'instagram', 'ig-it', '@it') returning id", [JOB_TENANT]);
    await admin.query(
      "insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values ($1, 'SEGREDO-CIFRADO', 'v1')", [acct.id]);
    await admin.query("insert into audit_events (tenant_id, action) values ($1, 'team.member_added')", [JOB_TENANT]);

    const dump = await exportTenant(tenantDb(JOB_TENANT));
    expect(dump.tables.company_profiles).toHaveLength(1);
    expect(dump.tables.social_accounts).toHaveLength(1);
    expect(dump.tables.audit_events).toHaveLength(1);
    expect(dump.tables.invitations).toHaveLength(1);
    expect(dump.tables.invitations[0]).not.toHaveProperty('token_hash');
    expect(dump.tables).not.toHaveProperty('social_account_secrets');
    const text = JSON.stringify(dump);
    expect(text).not.toContain('SEGREDO-CIFRADO');
    expect(text).not.toContain('a'.repeat(64));
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
