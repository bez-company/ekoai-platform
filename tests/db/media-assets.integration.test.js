// Banco de imagens contra o Postgres (SPEC 017 decisão 9, BEZ-198): upload com descrição por visão,
// visão que falha, limites do banco, filtros, autorização de uso de imagem, cópia publicável,
// "usada" ao publicar, isolamento entre contas e apagar. O bucket e o modelo são de memória.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const media = await import('../../platform/src/lib/media-assets.ts');
const model = await import('../../platform/src/lib/media-asset-model.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');
const { readThumb } = await import('../../platform/src/lib/media-thumbs.ts');
const { Resvg } = (await import('node:module')).createRequire(new URL('../../platform/package.json', import.meta.url))('@resvg/resvg-js');

const A = 'it-media-a';
const B = 'it-media-b';
const ANA = { id: '00000000-0000-4000-8000-000000000501', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const ta = tenantDb(A);
const tb = tenantDb(B);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes, type }),
  get: async (key) => {
    const o = objects.get(key);
    if (!o) throw new Error('sem objeto');
    return o.bytes;
  },
  remove: async (key) => void objects.delete(key),
};
const vision = (answer) => ({
  calls: [],
  async generateJson(input) {
    this.calls.push(input);
    if (answer instanceof Error) throw answer;
    return { json: answer, raw: '', inputTokens: 300, outputTokens: 30, modelVersion: null, durationMs: 1, costUsd: 0.0001 };
  },
});

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const png = (w = 640, h = 800) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND')]);
const photo = (name = 'bolo.png') => {
  const r = model.inspectPhoto(png());
  expect(r.ok).toBe(true);
  return { photo: r, name };
};

async function cleanup() {
  await resetTenantData(admin, [A, B]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into users (id, email, name) values ($1, $2, $3) on conflict do nothing', [ANA.id, 'it-ana-media@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Media A', B, 'It Media B']);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

let first;

describe('banco de imagens', () => {
  it('sobe a foto debaixo da pasta da conta e grava a descrição da visão', async () => {
    const models = vision({ description: 'Bolo de pote na bancada', tags: ['produto', 'gato'], has_people: false });
    const [asset] = await media.saveMediaAssets(ta, ANA, [photo()], { store, models });
    first = asset;
    expect(asset).toMatchObject({ contentType: 'image/png', width: 640, height: 800, originalName: 'bolo.png', description: 'Bolo de pote na bancada', tags: ['produto'], hasPeople: false, usedAt: null });
    expect(asset.describedAt).not.toBeNull();
    const r = await one('select storage_path, created_by from media_assets where id = $1', [asset.id]);
    expect(r.storage_path).toBe(`tenants/${A}/media/${asset.id}.png`);
    expect(r.created_by).toBe(ANA.id);
    expect(objects.has(r.storage_path)).toBe(true);
    expect(models.calls[0].image.mimeType).toBe('image/png');
    expect(models.calls[0].labels).toMatchObject({ tenant: A, step: 'media_describe' });
    expect((await one("select count(*)::int n from audit_events where tenant_id = $1 and action = 'media.uploaded'", [A])).n).toBe(1);
  });

  it('visão que falha não derruba o upload: a foto fica sem descrição', async () => {
    const [asset] = await media.saveMediaAssets(ta, ANA, [photo('equipe.png')], { store, models: vision(new Error('Vertex 503')) });
    expect(asset).toMatchObject({ description: null, describedAt: null, hasPeople: null });
  });

  it('o banco recusa caminho fora da conta e etiqueta fora da lista', async () => {
    await expect(admin.query("insert into media_assets (tenant_id, storage_path, content_type, byte_size, width, height) values ($1, 'tenants/it-media-b/media/x.png', 'image/png', 1, 400, 400)", [A])).rejects.toThrow(/check/);
    await expect(admin.query("update media_assets set tags = '{gato}' where id = $1", [first.id])).rejects.toThrow(/check/);
  });

  it('filtros: não usadas, usadas e etiqueta', async () => {
    expect((await media.listMediaAssets(ta, { filter: 'all', tag: null, limit: 60 })).length).toBe(2);
    expect((await media.listMediaAssets(ta, { filter: 'all', tag: 'produto', limit: 60 })).map((a) => a.id)).toEqual([first.id]);
    expect((await media.listMediaAssets(ta, { filter: 'used', tag: null, limit: 60 })).length).toBe(0);
  });

  it('foto com pessoa só vira URL publicável com a autorização de uso de imagem', async () => {
    await admin.query('update media_assets set has_people = true where id = $1', [first.id]);
    const err = await media.publishableMediaUrl(ta, first.id, { store, mediaBaseUrl: 'https://app.test/api/media' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(UserError);
    const updated = await media.updateMediaAsset(ta, ANA, first.id, { people_consent: true, tags: ['produto', 'cliente'] });
    expect(updated).toMatchObject({ peopleConsent: true, tags: ['produto', 'cliente'] });
    const { url: publicUrl, key } = await media.publishableMediaUrl(ta, first.id, { store, mediaBaseUrl: 'https://app.test/api/media' });
    expect(key).toMatch(/^images\/[0-9a-f-]{36}\.png$/);
    expect(publicUrl).toBe(`https://app.test/api/media/${key}`);
    expect(objects.get(key).bytes).toEqual(objects.get(`tenants/${A}/media/${first.id}.png`).bytes);
  });

  it('a outra conta não lê, não altera, não publica nem aponta agendado para a foto', async () => {
    expect(await media.getMediaAsset(tb, first.id)).toBeNull();
    expect(await media.readMediaAssetBytes(tb, first.id, store)).toBeNull();
    await expect(media.updateMediaAsset(tb, ANA, first.id, { description: 'x' })).rejects.toBeInstanceOf(UserError);
    await expect(media.publishableMediaUrl(tb, first.id, { store })).rejects.toBeInstanceOf(UserError);
    await expect(admin.query(
      "insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, media_asset_id) values ($1, 'instagram', '{}', 'x', now(), $2)",
      [B, first.id],
    )).rejects.toThrow(/scheduled_posts_media_asset_fk/);
  });

  it('marcar como usada grava a data e o post; apagar a foto solta o agendado', async () => {
    const post = await one("insert into posts (tenant_id, pillar, channel) values ($1, 'dica', 'instagram') returning id", [A]);
    const sched = await one(
      "insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, media_asset_id) values ($1, 'instagram', '{}', 'x', now(), $2) returning id",
      [A, first.id],
    );
    await media.markMediaAssetUsed(ta, first.id, post.id);
    const used = await media.getMediaAsset(ta, first.id);
    expect(used.usedPostId).toBe(post.id);
    expect(model.isSuggestable(used)).toBe(false);
    expect((await media.listMediaAssets(ta, { filter: 'used', tag: null, limit: 60 })).map((a) => a.id)).toEqual([first.id]);

    await media.deleteMediaAsset(ta, ANA, first.id, store);
    expect(objects.has(`tenants/${A}/media/${first.id}.png`)).toBe(false);
    expect((await one('select media_asset_id, tenant_id from scheduled_posts where id = $1', [sched.id]))).toEqual({ media_asset_id: null, tenant_id: A });
  });

  it('miniatura: nasce na primeira leitura, fica guardada, e a outra conta não lê', async () => {
    const real = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#C08040"/></svg>').render().asPng();
    const r = model.inspectPhoto(new Uint8Array(real));
    const [asset] = await media.saveMediaAssets(ta, ANA, [{ photo: r, name: 'mesa.png' }], { store, models: null });
    const key = `tenants/${A}/media/thumbs/${asset.id}.jpg`;
    expect(objects.has(key)).toBe(false);
    const first = await readThumb(ta, asset.id, store);
    expect(first[0]).toBe(0xff);
    expect(objects.has(key)).toBe(true);
    const puts = objects.size;
    expect(await readThumb(ta, asset.id, store)).toEqual(first);
    expect(objects.size).toBe(puts);
    expect(await readThumb(tb, asset.id, store)).toBeNull();
    await media.deleteMediaAsset(ta, ANA, asset.id, store);
    expect(objects.has(key)).toBe(false);
    expect(await readThumb(ta, asset.id, store)).toBeNull();
  });

  it('o limite da conta vale antes de subir qualquer arquivo', async () => {
    const before = objects.size;
    const many = Array.from({ length: model.MEDIA_MAX_PER_ACCOUNT }, () => photo());
    await expect(media.saveMediaAssets(ta, ANA, many, { store, models: null })).rejects.toThrow(/até 500 fotos/);
    expect(objects.size).toBe(before);
  });
});
