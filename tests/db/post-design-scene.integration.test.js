// O Studio livre contra o Postgres de verdade (SPEC 027): abrir o layout em camadas, gravar a cena como versão nova, conflito, revisor
// que trava, ajuste por campos que volta ao layout automático, baixar PNG e SVG. Nada chama o modelo depois de gerar o post.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { join } from 'node:path';
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
const rev = await import('../../platform/src/lib/post-design-revisions.ts');
const { NotFoundError, ConflictError, UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-scn-a';
const B = 'it-scn-b';
const PLAN = 'it-scn-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000911', name: 'Ana Ribeiro', sessionVersion: 1, lastTenantId: null };
const BRUNO = { id: '00000000-0000-4000-8000-000000000912', name: 'Bruno Costa', sessionVersion: 1, lastTenantId: null };
const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => { for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
};
const deps = { store, fontDir: FONT_DIR };

// O modelo só serve para gerar o post de partida. Depois disso, qualquer chamada é um bug.
let modelCalls = 0;
const model = {
  config: { project: 'p', location: 'global', textModel: 'texto-falso', imageModel: 'imagem-falsa' },
  async generateJson() {
    modelCalls += 1;
    return {
      json: { kind: 'informativo', angle: 'dica', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, caption: 'Bolo bom não tem pressa.', hashtags: ['bolo'] },
      raw: '', inputTokens: 1, outputTokens: 1, modelVersion: 'v1', durationMs: 1, costUsd: 0.0001,
    };
  },
  async generateImage() { throw new Error('o ajuste não pode gerar imagem'); },
};

const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const all = async (sql, params) => (await admin.query(sql, params)).rows;
const EDIT = (over = {}) => ({ layout: 'lista-numerada', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, ...over });

async function newPost(tenant, idea) {
  const t = tenantDb(tenant);
  const { id } = await requests.createPostRequest(t, ANA, { idea, kind: 'informativo' });
  const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
  expect(out.status).toBe('ready');
  const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
  return { id, t, pendingId: pending.pending_id, designId: pending.post_design_id };
}
const usedModel = () => one("select count(*)::int as n from generation_runs where tenant_id = $1", [A]);

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Scn', 'empresa', 5, 1, 50) on conflict (id) do update set max_posts_per_month = 50", [PLAN]);
  for (const u of [ANA, BRUNO]) await admin.query("insert into users (id, email, name) values ($1, $2, $3) on conflict (id) do nothing", [u.id, `it-scn-${u.name.split(' ')[0].toLowerCase()}@example.test`, u.name]);
  for (const id of [A, B]) {
    await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Scn', 'empresa', $2)", [id, PLAN]);
    const t = tenantDb(id);
    await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itrev' } });
    await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
    await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  }
  await admin.query("insert into tenant_members (user_id, tenant_id, role) values ($1, $2, 'admin'), ($3, $2, 'creator') on conflict do nothing", [ANA.id, A, BRUNO.id]).catch(() => undefined);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("delete from users where id in ($1, $2)", [ANA.id, BRUNO.id]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

const scn = (t, id, extra = {}) => rev.sceneState(t, id, extra, deps);
const moved = (scene, role, patch) => ({ ...scene, layers: scene.layers.map((l) => (l.role === role ? { ...l, ...patch } : l)) });

describe('Studio livre: a cena do post', () => {
  it('abre o layout em camadas sem gravar; confirmar grava a v2, troca o PNG e não chama o modelo', async () => {
    const { id, t, designId } = await newPost(A, 'dica de bolo');
    const calls = modelCalls;
    const open = await scn(t, id);
    expect(open).toMatchObject({ version: 1, custom: false, width: 1080, height: 1350, slide: null });
    expect(open.scene.layers.some((l) => l.type === 'text' && l.role === 'title')).toBe(true);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1', [designId])).length).toBe(0);

    const before = await one('select png_key from post_designs where id = $1', [designId]);
    const scene = moved(open.scene, 'title', { x: 100, text: 'Seu bolo pronto?' });
    const saved = await rev.saveScene(t, id, { baseVersion: 1, scene, userId: ANA.id }, deps);
    expect(saved).toMatchObject({ version: 2, source: 'edit', summary: 'Imagem editada no Studio' });
    const after = await one('select png_key, version, design from post_designs where id = $1', [designId]);
    expect(after.version).toBe(2);
    expect(after.png_key).not.toBe(before.png_key);
    expect(after.design.scene.layers.find((l) => l.role === 'title').text).toBe('Seu bolo pronto?');
    expect(objects.has(after.png_key)).toBe(true);
    expect(objects.has(before.png_key)).toBe(false);
    expect((await scn(t, id)).custom).toBe(true);
    expect(modelCalls).toBe(calls);
  });

  it('versão desatualizada vira conflito; cena inválida e fora da margem não gravam nada', async () => {
    const { id, t, designId } = await newPost(A, 'dica de bolo 2');
    const open = await scn(t, id);
    await rev.saveScene(t, id, { baseVersion: 1, scene: moved(open.scene, 'sub', { x: 90 }), userId: ANA.id }, deps);
    await expect(rev.saveScene(t, id, { baseVersion: 1, scene: open.scene, userId: BRUNO.id }, deps)).rejects.toBeInstanceOf(ConflictError);
    await expect(rev.saveScene(t, id, { baseVersion: 2, scene: { ...open.scene, layers: [{ id: 'x', type: 'script' }] }, userId: ANA.id }, deps)).rejects.toBeInstanceOf(UserError);
    await expect(rev.saveScene(t, id, { baseVersion: 2, scene: moved(open.scene, 'title', { x: -50 }), userId: ANA.id }, deps)).rejects.toThrow(/margem/);
    expect((await one('select version from post_designs where id = $1', [designId])).version).toBe(2);
  });

  it('um ajuste pelos campos (texto, cor, layout) volta ao layout automático', async () => {
    const { id, t, designId } = await newPost(A, 'dica de bolo 3');
    const open = await scn(t, id);
    await rev.saveScene(t, id, { baseVersion: 1, scene: moved(open.scene, 'title', { color: '#111111', x: 90 }), userId: ANA.id }, deps);
    const state = await rev.designState(t, id, deps);
    const saved = await rev.saveEdit(t, id, { baseVersion: 2, edit: { ...state.editable, logoCorner: 'tr' }, userId: ANA.id }, deps);
    expect(saved.version).toBe(3);
    expect((await one('select design from post_designs where id = $1', [designId])).design.scene).toBeUndefined();
    expect((await scn(t, id)).custom).toBe(false);
  });

  it('voltar ao layout automático grava uma versão e tira as camadas; sem camadas não há o que voltar', async () => {
    const { id, t, designId } = await newPost(A, 'dica de bolo 4');
    await expect(rev.resetScene(t, id, { baseVersion: 1, userId: ANA.id }, deps)).rejects.toBeInstanceOf(UserError);
    const open = await scn(t, id);
    await rev.saveScene(t, id, { baseVersion: 1, scene: moved(open.scene, 'sub', { x: 90 }), userId: ANA.id }, deps);
    const back = await rev.resetScene(t, id, { baseVersion: 2, userId: ANA.id }, deps);
    expect(back).toMatchObject({ version: 3, summary: 'Voltou ao layout automático' });
    expect((await one('select design from post_designs where id = $1', [designId])).design.scene).toBeUndefined();
  });

  it('baixa o PNG da versão em uso e o SVG com texto como elementos; o post de outra conta não existe', async () => {
    const { id, t } = await newPost(A, 'dica de bolo 5');
    const png = await rev.exportDesign(t, id, { format: 'png' }, deps);
    expect(png).toMatchObject({ contentType: 'image/png', filename: 'post-imagem.png' });
    expect(Buffer.from(png.body).subarray(1, 4).toString()).toBe('PNG');
    const svg = await rev.exportDesign(t, id, { format: 'svg' }, deps);
    expect(svg.contentType).toMatch(/svg/);
    expect(svg.body).toMatch(/<text /);
    expect(svg.body).not.toMatch(/rx="18"/);
    await expect(scn(tenantDb(B), id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
