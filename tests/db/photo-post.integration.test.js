// Publicar foto sem IA contra o Postgres (SPEC 017 decisão 10, BEZ-236): a foto do banco de imagens
// é cortada no formato, copiada para images/ e vira post agendado, na fila, publicado agora ou
// pendente em Aprovar; foto com pessoas sem autorização é recusada; a legenda pela foto passa pelo
// revisor. Bucket, modelo e publicação são de memória.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { deflateSync, crc32 } from 'node:zlib';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.MEDIA_BASE_URL = 'https://app.test/api/media';

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const media = await import('../../platform/src/lib/media-assets.ts');
const mediaModel = await import('../../platform/src/lib/media-asset-model.ts');
const photoPost = await import('../../platform/src/lib/photo-post.ts');
const scheduling = await import('../../platform/src/lib/scheduling.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const { pngSize } = await import('../../platform/src/lib/design/render.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-photo-a';
const ANA = { id: '00000000-0000-4000-8000-000000000901', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const t = tenantDb(A);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => {
    const o = objects.get(key);
    if (!o) throw new Error('sem objeto');
    return o.bytes;
  },
  remove: async (key) => void objects.delete(key),
};

// PNG de verdade (o corte decodifica a foto): 640x400, metade vermelha e metade azul.
function realPng(w = 640, h = 400) {
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, (_, x) => Buffer.from(x < w / 2 ? [255, 0, 0] : [0, 0, 255]))]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]));
}

async function upload(description = 'Bolo de morango na bancada', hasPeople = false) {
  const photo = mediaModel.inspectPhoto(realPng());
  expect(photo.ok).toBe(true);
  const models = { async generateJson() { return { json: { description, tags: ['produto'], has_people: hasPeople }, raw: '', inputTokens: 1, outputTokens: 1, modelVersion: null, durationMs: 1, costUsd: 0 }; } };
  const [asset] = await media.saveMediaAssets(t, ANA, [{ photo, name: 'bolo.png' }], { store, models });
  return asset;
}

const input = (assetId, extra = {}) => ({ assetId, ratio: '4:5', focus: { x: 0.5, y: 0.5 }, caption: 'Bolo de morango saindo agora.', hashtags: ['bolo'], when: 'schedule', canApprove: true, ...extra });

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-photo-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name) values ($1, 'It Photo')", [A]);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Confeitaria', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itphoto' } });
  await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
});

afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('publicar foto sem IA', () => {
  it('sem horário na agenda, a foto cortada em 4:5 entra na fila com o vínculo da foto', async () => {
    const asset = await upload();
    const out = await photoPost.createPhotoPost(t, ANA, input(asset.id), { store });
    expect(out.status).toBe('queued');
    const row = await one('select * from scheduled_posts where id = $1', [out.id]);
    expect(row).toMatchObject({ status: 'queued', scheduled_for: null, media_asset_id: asset.id, media_kind: 'image', pillar: 'foto', channel: 'instagram' });
    expect(row.caption_final).toBe('Bolo de morango saindo agora.\n\n#bolo');
    expect(row.image_url).toMatch(/^https:\/\/app\.test\/api\/media\/images\/[0-9a-f-]+\.png$/);
    const key = row.image_url.replace('https://app.test/api/media/', '');
    expect(pngSize(objects.get(key).bytes)).toEqual({ width: 1080, height: 1350 });
    expect(row.seed).toMatchObject({ source: 'photo', media_asset_id: asset.id, ratio: '4:5' });
    // nada da geração por IA: nenhuma chamada de modelo reservada
    expect((await one('select count(*)::int as n from generation_runs where tenant_id = $1', [A])).n).toBe(0);
  });

  it('publicar agora chama a publicação com o post criado; paisagem sai 1080x566', async () => {
    const asset = await upload();
    const calls = [];
    const publish = async (_t, id) => (calls.push(id), { ok: true });
    const out = await photoPost.createPhotoPost(t, ANA, input(asset.id, { ratio: '1.91:1', when: 'now' }), { store, publish });
    expect(out).toMatchObject({ status: 'published', error: null });
    expect(calls).toEqual([out.id]);
    const row = await one('select image_url, status from scheduled_posts where id = $1', [out.id]);
    expect(pngSize(objects.get(row.image_url.replace('https://app.test/api/media/', '')).bytes)).toEqual({ width: 1080, height: 566 });
  });

  it('quem não aprova manda para Aprovar; aprovar leva o vínculo da foto ao post agendado', async () => {
    const asset = await upload();
    const out = await photoPost.createPhotoPost(t, ANA, input(asset.id, { ratio: '1:1', canApprove: false }), { store });
    expect(out.status).toBe('pending');
    const pending = await one('select * from pending_approvals where pending_id = $1', [out.pendingId]);
    expect(pending).toMatchObject({ channel: 'instagram', status: 'awaiting_decision', top_id: 1 });
    expect(pending.seed).toMatchObject({ media_asset_id: asset.id, ratio: '1:1' });
    expect(pending.generation.variations[0]).toMatchObject({ body: 'Bolo de morango saindo agora.', hashtags: ['bolo'] });
    const approved = await scheduling.approvePending(t, { pendingId: out.pendingId, captionId: 1, artId: 1 });
    expect(await one('select media_asset_id from scheduled_posts where id = $1', [approved.id])).toEqual({ media_asset_id: asset.id });
  });

  it('foto com pessoas sem autorização de uso de imagem é recusada antes de gravar qualquer post', async () => {
    const asset = await upload('Equipe sorrindo no balcão', true);
    const before = (await one('select count(*)::int as n from scheduled_posts where tenant_id = $1', [A])).n;
    await expect(photoPost.createPhotoPost(t, ANA, input(asset.id), { store })).rejects.toThrow(UserError);
    expect((await one('select count(*)::int as n from scheduled_posts where tenant_id = $1', [A])).n).toBe(before);
    await expect(photoPost.createPhotoPost(t, ANA, input('3f8b2c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f'), { store })).rejects.toThrow(/não está mais no banco/);
  });

  it('a legenda pela foto manda a foto ao modelo, usa a descrição e passa pelo revisor', async () => {
    const asset = await upload();
    const calls = [];
    const model = (answer) => ({ config: { textModel: 'texto-falso' }, async generateJson(i) { calls.push(i); return { json: answer, raw: '', inputTokens: 10, outputTokens: 10, modelVersion: null, durationMs: 1, costUsd: 0.0001 }; } });
    const out = await photoPost.photoCaption(t, { assetId: asset.id, idea: null }, { model: model({ caption: 'Morango fresco no bolo de hoje.', hashtags: ['#Bolo', 'morango'] }), store });
    expect(out).toEqual({ caption: 'Morango fresco no bolo de hoje.', hashtags: ['bolo', 'morango'] });
    expect(calls[0].image.mimeType).toBe('image/png');
    expect(calls[0].prompt).toContain('Bolo de morango na bancada');
    expect(calls[0].labels).toMatchObject({ tenant: A, step: 'photo_caption' });
    await expect(photoPost.photoCaption(t, { assetId: asset.id, idea: null }, { model: model({ caption: 'Oferta imperdível', hashtags: [] }), store })).rejects.toThrow(/revisor/);
  });
});
