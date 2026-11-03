// Esforço em Aprovar contra o Postgres (BEZ-544): aprovar e rejeitar devolvem a chegada do post em Aprovar, a rede, a
// campanha do pedido e se a legenda mudou, para o evento do PostHog. Nenhum texto do post vai junto.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { approvePending, rejectPending } = await import('../../platform/src/lib/scheduling.ts');

const A = 'it-review-effort';
const t = tenantDb(A);

async function pending(id, { briefId = null, savedAt = '2026-11-04T13:00:00Z' } = {}) {
  await admin.query(
    `insert into pending_approvals (tenant_id, pending_id, channel, generation, images, post_kind, brief_id, saved_at)
     values ($1, $2, 'instagram', $3, $4, 'informativo', $5, $6)`,
    [A, id, JSON.stringify({ variations: [{ id: 1, hook: 'Título', body: 'Corpo do post' }] }), JSON.stringify([{ id: 1, url: 'https://app.test/img.png' }]), briefId, savedAt],
  );
}
async function briefOfCampaign() {
  const campaignId = (await admin.query("insert into campaigns (tenant_id, slug, name, status, confirmed_at) values ($1, 'semana-do-bolo', 'Semana do bolo', 'active', now()) returning id", [A])).rows[0].id;
  const briefId = (await admin.query("insert into briefs (tenant_id, idea, campaign_id) values ($1, 'bolo', $2) returning id", [A, campaignId])).rows[0].id;
  return { campaignId, briefId };
}

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('insert into tenants (id, name) values ($1, $1)', [A]);
});
beforeEach(async () => {
  for (const tb of ['scheduled_posts', 'pending_approvals', 'rejected_posts', 'notifications', 'briefs', 'campaigns']) await admin.query(`delete from ${tb} where tenant_id = $1`, [A]);
});
afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('esforço em Aprovar', () => {
  it('aprovar devolve a chegada, a campanha do pedido e a legenda editada', async () => {
    const { campaignId, briefId } = await briefOfCampaign();
    await pending('p-1', { briefId });
    const { effort } = await approvePending(t, { pendingId: 'p-1', captionId: 1, artId: 1, captionText: 'Corpo do post com outra frase' });
    expect(effort).toEqual({ savedAt: expect.any(String), channel: 'instagram', campaignId, captionEdited: true });
    expect(Date.parse(String(effort.savedAt))).toBe(Date.parse('2026-11-04T13:00:00Z'));
  });

  it('aprovar sem mexer na legenda e sem campanha', async () => {
    await pending('p-2');
    const { effort } = await approvePending(t, { pendingId: 'p-2', captionId: 1, artId: 1 });
    expect(effort).toMatchObject({ channel: 'instagram', campaignId: null, captionEdited: false });
  });

  it('rejeitar devolve a chegada e a campanha', async () => {
    const { campaignId, briefId } = await briefOfCampaign();
    await pending('p-3', { briefId });
    expect(await rejectPending(t, 'p-3', 'tom errado')).toMatchObject({ channel: 'instagram', campaignId });
  });
});
