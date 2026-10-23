// "Pedir ajuste" em texto livre contra o Postgres de verdade (SPEC 024): o patch do modelo vira uma versão pela
// mesma via do Confirmar, o que o pedido não citou fica idêntico no banco, o revisor barra sem gravar, o mesmo
// pedido não chama o modelo de novo, o desfazer restaura a versão anterior e o limite do mês não é tocado.
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
const { askAdjust } = await import('../../platform/src/lib/post-design-ask.ts');
const { NotFoundError, ConflictError, UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-ask-a';
const B = 'it-ask-b';
const PLAN = 'it-ask-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000b01', name: 'Ana Ribeiro', sessionVersion: 1, lastTenantId: null };
const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => { for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
};
const deps = { store, fontDir: FONT_DIR };

// O modelo falso: a geração recebe o texto de sempre; o pedido de ajuste recebe o que o teste pôs em `ask.json`.
const ask = { json: { image: { texts: { sub: null } } }, calls: 0, images: 0 };
const model = {
  config: { project: 'p', location: 'global', textModel: 'texto-falso', imageModel: 'imagem-falsa' },
  async generateJson({ labels }) {
    if (labels.step === 'ask') {
      ask.calls += 1;
      return { json: ask.json, raw: '', inputTokens: 1, outputTokens: 1, modelVersion: 'v', durationMs: 1, costUsd: 0.0001 };
    }
    return { json: { kind: 'informativo', angle: 'dica', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O cheiro enche a casa'] }, caption: 'Três sinais de que o bolo está no ponto. Chame no WhatsApp para encomendar.', hashtags: ['bolo', 'confeitaria'], altText: 'Lista de três sinais' }, raw: '', inputTokens: 1, outputTokens: 1, modelVersion: 'v', durationMs: 1, costUsd: 0 };
  },
  async generateImage() { ask.images += 1; throw new Error('sem imagem'); },
};

const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const all = async (sql, params) => (await admin.query(sql, params)).rows;
const input = (over = {}) => ({ baseVersion: 1, instruction: 'Tira o subtítulo', aspect: null, caption: 'Legenda atual do post.', hashtags: ['bolo'], userId: ANA.id, ...over });

async function newPost(tenant, idea) {
  const t = tenantDb(tenant);
  const { id } = await requests.createPostRequest(t, ANA, { idea, kind: 'informativo' });
  const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
  expect(out.status).toBe('ready');
  const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
  return { id, t, pendingId: pending.pending_id, designId: pending.post_design_id };
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Ask', 'empresa', 5, 1, 100) on conflict (id) do update set max_posts_per_month = 100", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-ask-ana@example.test', $2) on conflict (id) do nothing", [ANA.id, ANA.name]);
  for (const id of [A, B]) {
    await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Ask', 'empresa', $2)", [id, PLAN]);
    const t = tenantDb(id);
    await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itask' } });
    await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
    await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  }
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from users where id = $1', [ANA.id]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('pedir ajuste', () => {
  it('tirar o subtítulo grava a versão 2: só o subtítulo muda, sem modelo de imagem e sem gastar do limite', async () => {
    const p = await newPost(A, 'dicas de bolo');
    const before = (await one('select design, png_key from post_designs where id = $1', [p.designId]));
    const used = (await all("select 1 from generation_runs where tenant_id = $1 and step = 'visual'", [A])).length;
    ask.calls = 0;
    const out = await askAdjust(p.t, p.id, input(), { ...deps, model });
    expect(out.saved).toMatchObject({ version: 2, source: 'edit', summary: 'Subtítulo removido' });
    expect(out.modelCalls).toBe(1);
    expect(ask.calls).toBe(1);
    expect(ask.images).toBe(0);

    const after = await one('select design, png_key, version from post_designs where id = $1', [p.designId]);
    expect(after.version).toBe(2);
    expect(after.png_key).not.toBe(before.png_key);
    const { sub: _gone, ...restBefore } = before.design.texts;
    expect(after.design.texts).toEqual(restBefore);
    expect(after.design.layout).toBe(before.design.layout);
    expect(JSON.stringify(after.design.texts.items)).toBe(JSON.stringify(before.design.texts.items));
    const revs = await all('select version, parent_version, source, author_id, summary from post_design_revisions where post_design_id = $1 order by version', [p.designId]);
    expect(revs.map((r) => [r.version, r.parent_version, r.source])).toEqual([[1, null, 'initial'], [2, 1, 'edit']]);
    expect(revs[1].author_id).toBe(ANA.id);
    expect((await all("select 1 from generation_runs where tenant_id = $1 and step = 'visual'", [A])).length).toBe(used);
    // o PNG da pendência é o da versão nova (Aprovar publica o que está lá)
    const pending = await one('select images from pending_approvals where pending_id = $1', [p.pendingId]);
    expect(pending.images[0].path).toBe(after.png_key);
  });

  it('o mesmo pedido sobre a mesma versão não chama o modelo de novo (reserva idempotente)', async () => {
    const p = await newPost(A, 'segundo post');
    ask.calls = 0;
    await askAdjust(p.t, p.id, input(), { ...deps, model });
    expect(ask.calls).toBe(1);
    // desfaz (versão 3 = volta à 1) e repete o mesmo pedido: a entrada do modelo muda (a versão em uso mudou), então chama de novo;
    // repetir sobre a MESMA versão devolve a linha guardada
    const runs = await all("select id, status from generation_runs where brief_id = $1 and step = 'writer' order by created_at", [p.id]);
    expect(runs.filter((r) => r.status === 'done').length).toBeGreaterThanOrEqual(2); // a geração e o pedido
    const runsBefore = runs.length;
    await rev.restoreVersion(p.t, p.id, { version: 1, baseVersion: 2, userId: ANA.id }, deps);
    ask.calls = 0;
    await askAdjust(p.t, p.id, input({ baseVersion: 3 }), { ...deps, model });
    expect(ask.calls).toBe(0); // o prompt é igual ao da primeira vez (design da v3 = design da v1), então a reserva existente responde
    expect((await all("select 1 from generation_runs where brief_id = $1 and step = 'writer'", [p.id])).length).toBe(runsBefore);
  });

  it('desfazer volta ao design anterior como versão nova, sem apagar nenhuma', async () => {
    const p = await newPost(A, 'terceiro post');
    const original = (await one('select design from post_designs where id = $1', [p.designId])).design;
    const out = await askAdjust(p.t, p.id, input(), { ...deps, model });
    await rev.restoreVersion(p.t, p.id, { version: out.previousVersion, baseVersion: out.saved.version, userId: ANA.id }, deps);
    const now = await one('select design, version from post_designs where id = $1', [p.designId]);
    expect(now.version).toBe(3);
    expect(now.design.texts).toEqual(original.texts);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1', [p.designId])).length).toBe(3);
  });

  it('cor sem contraste: o revisor barra, nada é gravado e a versão segue a mesma', async () => {
    const p = await newPost(A, 'quarto post');
    ask.json = { image: { colors: { title: '#F4EAEE' } } };
    await expect(askAdjust(p.t, p.id, input({ instruction: 'Título quase branco' }), { ...deps, model })).rejects.toMatchObject({ issues: [expect.objectContaining({ rule: 'contrast' })] });
    ask.json = { image: { texts: { sub: null } } };
    expect((await one('select version from post_designs where id = $1', [p.designId])).version).toBe(1);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1 and version > 1', [p.designId])).length).toBe(0);
  });

  it('versão velha na tela: 409 sem chamar o modelo; "Visual" não chama o modelo nem grava', async () => {
    const p = await newPost(A, 'quinto post');
    await askAdjust(p.t, p.id, input(), { ...deps, model });
    ask.calls = 0;
    await expect(askAdjust(p.t, p.id, input({ baseVersion: 1, instruction: 'Outro ajuste' }), { ...deps, model })).rejects.toBeInstanceOf(ConflictError);
    const visual = await askAdjust(p.t, p.id, input({ baseVersion: 2, aspect: 'visual', instruction: 'Troca o fundo por uma foto' }), { ...deps, model });
    expect(visual).toMatchObject({ saved: null, needsVisual: true, modelCalls: 0 });
    expect(ask.calls).toBe(0);
  });

  it('só a legenda: a versão do design não muda; legenda com palavra proibida não vai', async () => {
    const p = await newPost(A, 'sexto post');
    ask.json = { caption: { caption: 'Legenda mais curta.', hashtags: ['#Bolo'] } };
    const ok = await askAdjust(p.t, p.id, input({ aspect: 'caption', instruction: 'Encurta a legenda' }), { ...deps, model });
    expect(ok).toMatchObject({ saved: null, caption: { caption: 'Legenda mais curta.', hashtags: ['bolo'] } });
    expect((await one('select version from post_designs where id = $1', [p.designId])).version).toBe(1);
    ask.json = { caption: { caption: 'Um bolo imperdível!' } };
    await expect(askAdjust(p.t, p.id, input({ aspect: 'caption', instruction: 'Deixa a legenda animada' }), { ...deps, model })).rejects.toBeInstanceOf(UserError);
    ask.json = { image: { texts: { sub: null } } };
  });

  it('isolamento: outra conta não pede ajuste no post da conta A', async () => {
    const p = await newPost(A, 'post da conta A');
    ask.calls = 0;
    await expect(askAdjust(tenantDb(B), p.id, input(), { ...deps, model })).rejects.toBeInstanceOf(NotFoundError);
    expect(ask.calls).toBe(0);
  });

  it('post já aprovado não aceita pedido', async () => {
    const p = await newPost(A, 'post decidido');
    await admin.query("update pending_approvals set status = 'approved' where pending_id = $1", [p.pendingId]);
    await expect(askAdjust(p.t, p.id, input(), { ...deps, model })).rejects.toBeInstanceOf(ConflictError);
  });
});
