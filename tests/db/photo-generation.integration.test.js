// Foto anexada no Criar post contra o Postgres (SPEC 017 decisão 7, BEZ-237): "como está" e "de fundo"
// usam a foto do banco no lugar do visual por IA e não contam no limite; "inspiração" gera com a foto
// de referência e conta; foto sem autorização ou apagada não vira post; aprovar leva a foto ao agendado.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.MEDIA_BASE_URL = 'https://app.test/api/media';

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { generatePost } = await import('../../platform/src/lib/generation.ts');
const requests = await import('../../platform/src/lib/post-requests.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const media = await import('../../platform/src/lib/media-assets.ts');
const model = await import('../../platform/src/lib/media-asset-model.ts');
const { approvePending } = await import('../../platform/src/lib/scheduling.ts');
const { pngSize } = await import('../../platform/src/lib/design/render.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');
const { photoQuestions } = await import('../../platform/src/lib/photo-questions.ts');
const { Resvg } = createRequire(join(import.meta.dirname, '../../platform/package.json'))('@resvg/resvg-js');

const A = 'it-photo-gen';
const ANA = { id: '00000000-0000-4000-8000-000000000901', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');
const t = tenantDb(A);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async () => {},
};

const ATM = { kind: 'informativo', angle: 'bastidor', texts: { kicker: 'Quarta de massa', title: 'Bolo bom não tem pressa' }, caption: 'Bastidor de hoje.', hashtags: ['bastidores'], visual_prompt: 'flour on a wooden table, warm light' };
function fakeModel() {
  const calls = [];
  return {
    calls,
    config: { project: 'p', location: 'global', textModel: 'texto-falso', imageModel: 'imagem-falsa' },
    async generateJson({ prompt }) {
      calls.push({ step: 'writer', prompt });
      return { json: ATM, raw: '', inputTokens: 100, outputTokens: 50, modelVersion: 'v1', durationMs: 10, costUsd: 0.0001 };
    },
    async generateImage({ prompt, reference }) {
      calls.push({ step: 'visual', prompt, reference });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      return { png, inputTokens: 20, outputTokens: 1120, modelVersion: 'img-1', durationMs: 20, costUsd: 0.0672 };
    },
  };
}

// Foto de verdade (PNG 800x600 decodificável), para o corte e o render rodarem de fato.
const PHOTO = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#C08040"/><circle cx="400" cy="300" r="200" fill="#402010"/></svg>').render().asPng();
let assetId;
let personId;

async function upload(name) {
  const r = model.inspectPhoto(new Uint8Array(PHOTO));
  expect(r.ok).toBe(true);
  const [a] = await media.saveMediaAssets(t, ANA, [{ photo: r, name }], { store, models: null });
  return a.id;
}
const request = (usage, id = assetId) => requests.createPostRequest(t, ANA, { idea: 'o forno de manhã', kind: 'atmosfera', photo: { assetId: id, usage } });
const runs = async (briefId, step) => (await one('select count(*)::int n from generation_runs where brief_id = $1 and step = $2', [briefId, step])).n;

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-photo-gen@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name) values ($1, 'It Photo Gen')", [A]);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itphoto' } });
  assetId = await upload('forno.png');
  await admin.query("update media_assets set description = 'Forno a lenha aceso' where id = $1", [assetId]);
  personId = await upload('equipe.png');
  await admin.query('update media_assets set has_people = true where id = $1', [personId]);
});
afterAll(async () => {
  await resetTenantData(admin, [A, 'it-photo-gen-b']);
  await admin.query("delete from plans where id = 'it-photo-cap'");
  await admin.end();
});

describe('foto anexada no pedido de post', () => {
  it('"como está": a foto cortada é a imagem do post, sem chamar o modelo de imagem nem contar no limite', async () => {
    const m = fakeModel();
    const { id } = await request('as_is');
    const out = await generatePost(t, id, { model: m, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(m.calls.map((c) => c.step)).toEqual(['writer']);
    expect(m.calls[0].prompt).toContain('vai no post como está');
    expect(m.calls[0].prompt).toContain('Forno a lenha aceso');
    expect(await runs(id, 'visual')).toBe(0);
    const p = await one('select images, seed, post_kind from pending_approvals where brief_id = $1', [id]);
    expect(p.post_kind).toBe('atmosfera');
    expect(p.seed).toMatchObject({ photo_usage: 'as_is', media_asset_id: assetId });
    const png = objects.get(p.images[0].path).bytes;
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 });
    const d = await one('select design, visual_key from post_designs where brief_id = $1', [id]);
    expect(d.design.photo).toEqual({ assetId, usage: 'as_is' });
    expect(objects.get(d.visual_key).bytes.equals(png)).toBe(true);
  });

  it('"de fundo": o título vai sobre a foto, ainda sem modelo de imagem', async () => {
    const m = fakeModel();
    const { id } = await request('background');
    expect((await generatePost(t, id, { model: m, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(m.calls.map((c) => c.step)).toEqual(['writer']);
    const d = await one('select visual_key, png_key from post_designs where brief_id = $1', [id]);
    expect(d.visual_key).not.toBe(d.png_key);
    expect(objects.get(d.png_key).bytes.equals(objects.get(d.visual_key).bytes)).toBe(false);
    expect(pngSize(objects.get(d.png_key).bytes)).toEqual({ width: 1080, height: 1350 });
  });

  it('"inspiração": gera a imagem com a foto de referência, conta no limite e não marca a foto', async () => {
    const m = fakeModel();
    const { id } = await request('inspiration');
    expect((await generatePost(t, id, { model: m, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(m.calls.map((c) => c.step)).toEqual(['writer', 'visual']);
    expect(m.calls[1].reference.mimeType).toBe('image/png');
    expect(await runs(id, 'visual')).toBe(1);
    const p = await one('select seed from pending_approvals where brief_id = $1', [id]);
    expect(p.seed.photo_usage).toBe('inspiration');
    expect(p.seed.media_asset_id).toBeUndefined();
  });

  it('aprovar o post com a foto leva a foto ao agendado (o publish marca como usada)', async () => {
    const m = fakeModel();
    const { id } = await request('as_is');
    const out = await generatePost(t, id, { model: m, store, fontDir: FONT_DIR });
    const { id: schedId } = await approvePending(t, { pendingId: out.pendingId, captionId: 1, artId: 1 });
    expect((await one('select media_asset_id from scheduled_posts where id = $1', [schedId])).media_asset_id).toBe(assetId);
  });

  it('foto com pessoas sem autorização não entra no pedido', async () => {
    await expect(request('as_is', personId)).rejects.toBeInstanceOf(UserError);
  });

  it('foto apagada depois do pedido: a geração falha com o próximo passo e nada é gerado', async () => {
    const tmp = await upload('tmp.png');
    const { id } = await request('background', tmp);
    await media.deleteMediaAsset(t, ANA, tmp, store);
    const m = fakeModel();
    const out = await generatePost(t, id, { model: m, store, fontDir: FONT_DIR });
    expect(out).toMatchObject({ status: 'failed', error: expect.stringMatching(/saiu do banco de imagens/) });
    expect(m.calls).toEqual([]);
  });

  it('perguntas: a visão só roda quando precisa perguntar o que escrever, e entra no teto do dia', async () => {
    const vision = { calls: 0, async generateJson(input) { this.calls += 1; expect(input.image.mimeType).toBe('image/png'); return { json: { suggestions: ['Forno aceso às 5h', 'A massa descansando'] }, costUsd: 0.0001, inputTokens: 1, outputTokens: 1, modelVersion: null }; } };
    const both = await photoQuestions(t, { assetId, idea: '' }, { store, models: vision });
    expect(both.questions.map((q) => q.id)).toEqual(['usage', 'text']);
    expect(both.questions[1].options.map((o) => o.label)).toEqual(['Forno aceso às 5h', 'A massa descansando', 'Escrever eu']);
    const none = await photoQuestions(t, { assetId, idea: 'de fundo: abrimos domingo às 9h com bolo quente' }, { store, models: vision });
    expect(none).toEqual({ questions: [], inferredUsage: 'background', describe: false });
    expect(vision.calls).toBe(1);
    expect((await one("select count(*)::int n from vision_calls where tenant_id = $1 and kind = 'photo_caption' and status = 'done'", [A])).n).toBe(1);

    // Teto do dia batido: sem chamar o modelo, fica só "Escrever eu".
    const before = await one('select plan_id, kind from tenants where id = $1', [A]);
    await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_photo_captions_per_day) values ('it-photo-cap', 'Cap', $1, 5, 1, 1) on conflict (id) do update set max_photo_captions_per_day = 1", [before.kind]);
    await admin.query("update tenants set plan_id = 'it-photo-cap' where id = $1", [A]);
    const capped = await photoQuestions(t, { assetId, idea: 'use de fundo' }, { store, models: vision });
    expect(capped.questions).toEqual([{ id: 'text', text: 'O que escrever?', options: [{ value: 'own', label: 'Escrever eu' }] }]);
    expect(vision.calls).toBe(1);
    await admin.query('update tenants set plan_id = $2 where id = $1', [A, before.plan_id]);
  });

  it('perguntas sobre foto com pessoas sem autorização são recusadas', async () => {
    await expect(photoQuestions(t, { assetId: personId, idea: '' }, { store, models: null })).rejects.toBeInstanceOf(UserError);
  });

  it('o banco recusa uso fora da lista e foto de outra conta', async () => {
    await admin.query("insert into tenants (id, name) values ('it-photo-gen-b', 'B') on conflict do nothing");
    await expect(admin.query("insert into briefs (tenant_id, pillar, idea, status, photo_usage) values ($1, 'x', 'x', 'queued', 'cartaz')", [A])).rejects.toThrow(/check/);
    await expect(admin.query("insert into briefs (tenant_id, pillar, idea, status, asset_id, photo_usage) values ('it-photo-gen-b', 'x', 'x', 'queued', $1, 'as_is')", [assetId])).rejects.toThrow(/briefs_media_asset_fk/);
  });
});
