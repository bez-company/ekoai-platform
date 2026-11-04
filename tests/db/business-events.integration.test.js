// Resultados com origem contra o Postgres (SPEC 038, BEZ-551): o registro pelo post herda a campanha dele, a outra conta não
// vê nem usa o que não é dela, e só quem registrou ou quem gerencia a marca apaga.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const be = await import('../../platform/src/lib/business-events.ts');

const A = 'it-results-a';
const B = 'it-results-b';
const t = tenantDb(A);
const ANA = { id: '0b5a6c1e-2b4a-4c5d-8e9f-0a1b2c3d4e03', email: 'it-results-ana@example.test', name: 'Ana Ribeiro' };
const BRUNO = { id: '0b5a6c1e-2b4a-4c5d-8e9f-0a1b2c3d4e04', email: 'it-results-bruno@example.test', name: 'Bruno Costa' };
const input = (extra = {}) => ({ kind: 'order', occurred_on: '2026-11-02', value_brl: 89, origin: 'declared', campaign_id: null, post_id: null, note: null, ...extra });

const campaign = async (tenant) => (await admin.query("insert into campaigns (tenant_id, slug, name, status, confirmed_at) values ($1, $2, 'Fim de ano', 'active', now()) returning id", [tenant, `c-${Math.random().toString(36).slice(2, 8)}`])).rows[0].id;
// Um post publicado da campanha: o agendado com a campanha e o post durável ligado a ele.
async function publishedPost(tenant, campaignId, { viaBrief = false } = {}) {
  let briefId = null;
  if (viaBrief) briefId = (await admin.query("insert into briefs (tenant_id, idea, campaign_id) values ($1, 'caixa', $2) returning id", [tenant, campaignId])).rows[0].id;
  const sp = (
    await admin.query(
      "insert into scheduled_posts (tenant_id, channel, variation, caption_final, status, scheduled_for, published_at, campaign_id, brief_id) values ($1, 'instagram', $2, 'Legenda', 'published', now(), now(), $3, $4) returning id",
      [tenant, JSON.stringify({ id: 1, hook: 'Caixa de panetone' }), viaBrief ? null : campaignId, briefId],
    )
  ).rows[0].id;
  const post = (await admin.query("insert into posts (tenant_id, pillar, channel, published_at, scheduled_post_id) values ($1, 'post', 'instagram', now(), $2) returning id", [tenant, sp])).rows[0].id;
  await admin.query('update scheduled_posts set post_id = $2 where id = $1', [sp, post]);
  return post;
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  for (const u of [ANA, BRUNO]) await admin.query('insert into users (id, email, name) values ($1, $2, $3) on conflict (id) do nothing', [u.id, u.email, u.name]);
});
beforeEach(async () => {
  for (const tb of ['business_events', 'posts', 'scheduled_posts', 'briefs', 'campaigns']) await admin.query(`delete from ${tb} where tenant_id = any($1)`, [[A, B]]);
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from users where id = any($1)', [[ANA.id, BRUNO.id]]);
  await admin.end();
});

describe('registrar', () => {
  it('pelo post: herda a campanha do agendado ou do pedido, e aparece nas duas listas', async () => {
    const c = await campaign(A);
    const direct = await publishedPost(A, c);
    const viaBrief = await publishedPost(A, c, { viaBrief: true });
    const e1 = await be.recordEvent(t, ANA, input({ post_id: direct }));
    const e2 = await be.recordEvent(t, ANA, input({ post_id: viaBrief, kind: 'sale', value_brl: 178, origin: 'observed' }));
    expect([e1.campaignId, e2.campaignId]).toEqual([c, c]);
    expect((await be.listCampaignEvents(t, c)).map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
    expect((await be.listPostEvents(t, direct)).map((e) => [e.kind, e.createdByName])).toEqual([['order', 'Ana Ribeiro']]);
  });

  it('os posts da campanha para o formulário, com o gancho como título', async () => {
    const c = await campaign(A);
    const p = await publishedPost(A, c);
    expect(await be.campaignPosts(t, c)).toEqual([{ id: p, title: 'Caixa de panetone' }]);
  });

  it('campanha ou post de outra conta não entra', async () => {
    const otherCampaign = await campaign(B);
    const otherPost = await publishedPost(B, otherCampaign);
    await expect(be.recordEvent(t, ANA, input({ campaign_id: otherCampaign }))).rejects.toThrow(/Campanha não encontrada/);
    await expect(be.recordEvent(t, ANA, input({ post_id: otherPost }))).rejects.toThrow(/Post não encontrado/);
    expect(await be.listCampaignEvents(tenantDb(B), otherCampaign)).toEqual([]);
  });

  it('o banco recusa contato com valor, mesmo se o parser falhar', async () => {
    await expect(admin.query("insert into business_events (tenant_id, kind, occurred_on, value_brl, origin) values ($1, 'contact', '2026-11-02', 10, 'unknown')", [A])).rejects.toThrow(/check/);
  });
});

describe('apagar', () => {
  it('quem registrou apaga; outra pessoa da equipe não; quem gerencia a marca apaga', async () => {
    const c = await campaign(A);
    const e = await be.recordEvent(t, ANA, input({ campaign_id: c }));
    await expect(be.deleteEvent(t, BRUNO, e.id, false)).rejects.toThrow(/Só quem registrou/);
    await be.deleteEvent(t, ANA, e.id, false);
    const f = await be.recordEvent(t, ANA, input({ campaign_id: c }));
    await be.deleteEvent(t, BRUNO, f.id, true);
    expect(await be.listCampaignEvents(t, c)).toEqual([]);
  });
});
