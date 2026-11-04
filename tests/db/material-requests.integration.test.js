// Pedidos de material contra o Postgres (SPEC 036, BEZ-549): a rodada pede o que falta, responde pelo banco de imagens e
// pelos fatos, e nunca passa de 2 abertos. Sem modelo: a regra é por código.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const mr = await import('../../platform/src/lib/material-requests.ts');
const { listMediaAssets } = await import('../../platform/src/lib/media-assets.ts');

const A = 'it-material-a';
const B = 'it-material-b';
const t = tenantDb(A);
const ANA = { id: '0b5a6c1e-2b4a-4c5d-8e9f-0a1b2c3d4e01', email: 'it-material-ana@example.test', name: 'Ana' };
const now = new Date('2026-10-22T12:00:00Z');
const SAT = '2026-10-24T21:00:00Z';

async function suggestion(goal, extra = {}) {
  const { rows } = await admin.query(
    `insert into content_suggestions (tenant_id, slot_at, goal, idea, reason, campaign_id) values ($1, $2, $3, 'Caixa de panetone com doce de leite', 'Motivo do coordenador.', $4) returning id`,
    [extra.tenant ?? A, extra.slotAt ?? SAT, goal, extra.campaignId ?? null],
  );
  return rows[0].id;
}
async function photo(tags, { hasPeople = false, consent = false } = {}) {
  const { rows } = await admin.query(
    "insert into media_assets (tenant_id, storage_path, content_type, byte_size, width, height, tags, has_people, people_consent) values ($1, 'tenants/' || $1 || '/media/' || gen_random_uuid() || '.jpg', 'image/jpeg', 10, 1080, 1350, $2, $3, $4) returning id",
    [A, tags, hasPeople, consent],
  );
  return rows[0].id;
}
const campaign = async () => (await admin.query("insert into campaigns (tenant_id, slug, name, status, confirmed_at) values ($1, 'fim-de-ano', 'Fim de ano', 'active', now()) returning id", [A])).rows[0].id;
const fact = async (validUntil) =>
  (await admin.query("insert into company_facts (tenant_id, kind, text, status, verified_at, valid_until, category) values ($1, 'fact', 'Caixa de panetone por R$ 89', 'confirmed', now(), $2, 'oferta_preco') returning id", [A, validUntil])).rows[0].id;
const round = async (at = now) => mr.askAfterPlanning(t, await listMediaAssets(t, { filter: 'all', tag: null, limit: 500 }), at);
const reqRow = async (id) => (await admin.query('select status, outcome, answered_asset_id, reminded_at from material_requests where id = $1', [id])).rows[0];
const notices = async () => (await admin.query('select kind from notifications where tenant_id = $1 order by id', [A])).rows.map((r) => r.kind);

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await admin.query('insert into users (id, email, name) values ($1, $2, $3) on conflict (id) do nothing', [ANA.id, ANA.email, ANA.name]);
});
beforeEach(async () => {
  for (const tb of ['material_requests', 'content_suggestions', 'notifications', 'media_assets', 'company_facts', 'campaigns']) {
    await admin.query(`delete from ${tb} where tenant_id = any($1)`, [[A, B]]);
  }
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from users where id = $1', [ANA.id]);
  await admin.end();
});

describe('a rodada pede o que falta', () => {
  it('produto sem foto no banco: um pedido de foto ligado à sugestão, com aviso', async () => {
    const s = await suggestion('produto');
    const req = await round();
    expect(req).toMatchObject({ kind: 'photo', needTag: 'produto', suggestionId: s, status: 'open', dueAt: new Date(SAT).toISOString() });
    expect(await notices()).toEqual(['material.requested']);
    expect((await mr.listOpenRequests(t, now)).map((r) => r.id)).toEqual([req.id]);
  });

  it('com foto de produto no banco, não pede; a rodada seguinte não repete o pedido aberto', async () => {
    await suggestion('produto');
    await photo(['produto']);
    expect(await round()).toBeNull();
    await admin.query('delete from media_assets where tenant_id = $1', [A]);
    expect(await round()).not.toBeNull();
    expect(await round()).toBeNull();
    expect((await admin.query("select count(*)::int as n from material_requests where tenant_id = $1 and status = 'open'", [A])).rows[0].n).toBe(1);
  });

  it('nunca passa de 2 abertos, e um por rodada', async () => {
    await suggestion('produto');
    await suggestion('bastidores', { slotAt: '2026-10-27T21:00:00Z' });
    await suggestion('prova_social', { slotAt: '2026-10-29T21:00:00Z' });
    expect((await round()).needTag).toBe('produto');
    expect((await round()).needTag).toBe('bastidor');
    expect(await round()).toBeNull();
  });

  it('a conta B não vê o pedido da conta A', async () => {
    await suggestion('produto');
    await round();
    expect(await mr.listOpenRequests(tenantDb(B), now)).toEqual([]);
  });

  it('vence no horário do post e sai do Início; lembra uma vez 24 h antes', async () => {
    await suggestion('produto');
    const req = await round();
    await round(new Date('2026-10-24T00:00:00Z'));
    expect((await reqRow(req.id)).reminded_at).not.toBeNull();
    await round(new Date('2026-10-24T06:00:00Z'));
    expect((await notices()).filter((k) => k === 'material.reminder')).toHaveLength(1);
    await round(new Date('2026-10-24T22:00:00Z'));
    expect(await reqRow(req.id)).toMatchObject({ status: 'expired', outcome: 'expired' });
  });
});

describe('responder', () => {
  it('foto do banco responde: ganha a etiqueta e entra na sugestão', async () => {
    const s = await suggestion('produto');
    const req = await round();
    const asset = await photo([]);
    expect(await mr.answerPhoto(t, ANA, req.id, asset, now)).toEqual({ usedInPost: true });
    expect(await reqRow(req.id)).toMatchObject({ status: 'answered', outcome: 'photo', answered_asset_id: asset });
    expect((await admin.query('select tags from media_assets where id = $1', [asset])).rows[0].tags).toEqual(['produto']);
    expect((await admin.query('select asset_id from content_suggestions where id = $1', [s])).rows[0].asset_id).toBe(asset);
    await expect(mr.answerPhoto(t, ANA, req.id, asset, now)).rejects.toThrow(/já foi respondido/);
  });

  it('foto com pessoas sem autorização responde, mas não entra no post', async () => {
    const s = await suggestion('produto');
    const req = await round();
    const asset = await photo(['produto'], { hasPeople: true, consent: false });
    expect(await mr.answerPhoto(t, ANA, req.id, asset, now)).toEqual({ usedInPost: false });
    expect((await admin.query('select asset_id from content_suggestions where id = $1', [s])).rows[0].asset_id).toBeNull();
  });

  it('"Não tenho agora" fecha o pedido e a rodada não pede de novo por 14 dias', async () => {
    await suggestion('produto');
    const req = await round();
    await mr.dismissRequest(t, ANA, req.id, now);
    expect(await reqRow(req.id)).toMatchObject({ status: 'dismissed', outcome: 'dismissed' });
    expect(await round()).toBeNull();
  });

  it('confirmar fato: continua (prazo novo), mudou (texto novo já confirmado) ou não vale mais (desligado)', async () => {
    const c = await campaign();
    await suggestion('ensinar', { campaignId: c });
    const f = await fact('2026-10-25');
    const keep = await round();
    expect(keep).toMatchObject({ kind: 'confirm', factId: f, campaignId: c });
    expect(await mr.answerConfirm(t, ANA, keep.id, { action: 'keep', validUntil: '2026-12-15' }, now)).toEqual({ outcome: 'kept' });
    expect((await admin.query('select valid_until::text, status from company_facts where id = $1', [f])).rows[0]).toEqual({ valid_until: '2026-12-15', status: 'confirmed' });

    await admin.query("update company_facts set valid_until = '2026-10-25' where id = $1", [f]);
    await admin.query("update material_requests set answered_at = now() - interval '20 days', created_at = now() - interval '20 days' where id = $1", [keep.id]);
    const edit = await round();
    expect(await mr.answerConfirm(t, ANA, edit.id, { action: 'edit', text: 'Caixa de panetone por R$ 95', validUntil: '2026-12-15' }, now)).toEqual({ outcome: 'edited' });
    expect((await admin.query('select text, status from company_facts where id = $1', [f])).rows[0]).toEqual({ text: 'Caixa de panetone por R$ 95', status: 'confirmed' });

    await admin.query("update company_facts set valid_until = '2026-10-25' where id = $1", [f]);
    await admin.query("update material_requests set answered_at = now() - interval '20 days', created_at = now() - interval '20 days' where tenant_id = $1", [A]);
    const off = await round();
    expect(await mr.answerConfirm(t, ANA, off.id, { action: 'off' }, now)).toEqual({ outcome: 'off' });
    expect((await admin.query('select active from company_facts where id = $1', [f])).rows[0].active).toBe(false);
  });

  it('prazo inválido na confirmação não fecha o pedido', async () => {
    const c = await campaign();
    await suggestion('ensinar', { campaignId: c });
    await fact('2026-10-25');
    const req = await round();
    await expect(mr.answerConfirm(t, ANA, req.id, { action: 'keep', validUntil: '2026-01-01' }, now)).rejects.toThrow(/já passou/);
    expect((await reqRow(req.id)).status).toBe('open');
  });
});
