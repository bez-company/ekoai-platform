// O post do estúdio contra o Postgres (SPEC 030, F3b), com modelo e renderer falsos: o modelo pronto (Rápido) vira pendência em Aprovar,
// o pedido repetido não gera de novo, erro do motor devolve `fallback` sem mexer no pedido, o que o estúdio não faz fica com o gerador de
// hoje e o limite do plano vale para post com imagem de IA. Nenhuma chamada paga.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.MEDIA_BASE_URL = 'https://app.test/api/media';

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { generateStudioPost } = await import('../../platform/src/lib/studio/generate.ts');
const { isStudioDesign } = await import('../../platform/src/lib/studio/is-studio.ts');
const { chooseStudioOption } = await import('../../platform/src/lib/studio/options.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');

const A = 'it-studio-a';
const B = 'it-studio-b'; // sem perfil
const PLAN = 'it-studio-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000901', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rows = async (sql, params) => (await admin.query(sql, params)).rows;

const LIB_DIR = join(import.meta.dirname, '../../platform/src/lib/studio/library');
const template = JSON.parse(readFileSync(join(LIB_DIR, 'cartaz-tipografico-1.json'), 'utf8'));

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => { for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
};

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const renderer = (issues = []) => ({ render: async () => ({ png: PNG, issues, texts: [] }) });

const FILL = JSON.stringify({
  template: template.id,
  slots: { headline: 'Bolo bom não tem pressa', support: 'Três sinais de que o bolo está no ponto.', extra1: 'Dica da casa' },
  caption: 'O bolo está no ponto quando o palito sai limpo e a massa volta ao toque. Salve este post e confira na próxima fornada.',
  hashtags: ['#bolo', '#confeitaria'],
  altText: 'Cartaz com a frase Bolo bom não tem pressa',
  palette: { bg: '#B83262', ink: '#FFFFFF', accent: '#F2A9C4' },
  imagePrompt: null,
});

// Modelo falso do estúdio: devolve o roteiro e conta as chamadas.
function fakeModel(script = [FILL]) {
  const calls = [];
  return {
    calls,
    costUsd: 0,
    costByStep: {},
    async text(call) {
      calls.push(call.step);
      const next = script.shift();
      if (next instanceof Error) throw next;
      this.costUsd += 0.004;
      this.costByStep.preenchimento = { calls: calls.length, usd: this.costUsd };
      return next;
    },
    async image() {
      throw new Error('o teste não gera imagem');
    },
  };
}
const deps = (model, extra = {}) => ({ modelFor: () => model, renderer: renderer(), library: [template], store, ...extra });

async function brief(tenant, idea, values = {}) {
  const v = { effort: 'instantaneo', style: 'auto', format: 'single', ...values };
  return (await one("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, effort, style, format) values ($1, 'dica', $2, 'generating', 'platform', 'informativo', $3, $4, $5) returning id", [tenant, idea, v.effort, v.style, v.format])).id;
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Studio', 'empresa', 5, 1, 1) on conflict (id) do update set max_posts_per_month = 1", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-studio-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Studio', 'empresa', $2), ($3, 'It Studio B', 'empresa', $2)", [A, PLAN, B]);
  const t = tenantDb(A);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itstudio' } });
  await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('Rápido pelo modelo pronto', () => {
  it('vira pendência em Aprovar, com o PNG, o HTML e o design do estúdio', async () => {
    const t = tenantDb(A);
    const id = await brief(A, 'sinais de que o bolo está no ponto');
    const model = fakeModel();
    const out = await generateStudioPost(t, id, deps(model));
    expect(out).toMatchObject({ status: 'ready', briefId: id, engine: 'template' });
    expect(model.calls).toEqual(['preenchimento']);

    const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
    expect(pending.status).toBe('awaiting_decision');
    expect(pending.images[0].url).toMatch(/^https:\/\/app\.test\/api\/media\/images\/.+\.png$/);
    expect(pending.generation.variations[0]).toMatchObject({ hook: 'Bolo bom não tem pressa', hashtags: ['#bolo', '#confeitaria'] });
    expect(pending.generation.studio).toMatchObject({ engine: 'template', effort: 'instantaneo' });

    const design = await one('select * from post_designs where brief_id = $1', [id]);
    expect(design).toMatchObject({ layout: 'studio', kind: 'informativo', ratio: '4:5' });
    expect(isStudioDesign(design.design)).toBe(true);
    expect(design.design.studio).toMatchObject({ engine: 'template', template: template.id, headline: 'Bolo bom não tem pressa' });
    expect(objects.get(design.png_key).type).toBe('image/png');
    expect(objects.get(design.design.studio.htmlKey).bytes.toString()).toContain('Bolo bom não tem pressa');

    expect((await one('select status from briefs where id = $1', [id])).status).toBe('ready');
    const run = await one("select status, cost_usd from generation_runs where brief_id = $1 and step = 'render'", [id]);
    expect(run.status).toBe('done');
    expect(Number(run.cost_usd)).toBeGreaterThan(0);
    expect((await one("select count(*)::int n from notifications where kind = 'post.ready' and tenant_id = $1", [A])).n).toBe(1);
  });

  it('pedido repetido devolve a mesma pendência e não chama o modelo', async () => {
    const t = tenantDb(A);
    const id = await brief(A, 'pedido repetido');
    const first = await generateStudioPost(t, id, deps(fakeModel()));
    const model = fakeModel();
    const again = await generateStudioPost(t, id, deps(model));
    expect(again).toMatchObject({ status: 'ready', pendingId: first.pendingId });
    expect(model.calls).toEqual([]);
    expect((await one('select count(*)::int n from pending_approvals where brief_id = $1', [id])).n).toBe(1);
  });

  it('erro do modelo devolve fallback: o pedido segue gerando e nada vai para Aprovar', async () => {
    const t = tenantDb(A);
    const id = await brief(A, 'modelo fora do ar');
    const out = await generateStudioPost(t, id, deps(fakeModel([new Error('Vertex 503'), new Error('Vertex 503')])));
    expect(out).toMatchObject({ status: 'fallback', briefId: id });
    expect((await one('select status from briefs where id = $1', [id])).status).toBe('generating');
    expect((await one('select count(*)::int n from pending_approvals where brief_id = $1', [id])).n).toBe(0);
    expect((await one("select status from generation_runs where brief_id = $1 and step = 'render'", [id])).status).toBe('failed');
  });

  it('defeito de layout medido no render também cai no gerador de hoje', async () => {
    const t = tenantDb(A);
    const id = await brief(A, 'layout estourado');
    const bad = { ...deps(fakeModel([FILL, FILL])), renderer: renderer([{ rule: 'safe_margin', detail: 'título' }]) };
    const out = await generateStudioPost(t, id, bad);
    expect(out).toMatchObject({ status: 'fallback' });
    // O motivo diz qual defeito foi medido e a peça recusada fica guardada para investigar.
    expect(out.reason).toContain('safe_margin');
    expect([...objects.keys()].some((k) => k === `studio-rejected/${id}/final.png`)).toBe(true);
  });
});

describe('o que o estúdio ainda não faz fica com o gerador de hoje', () => {
  it('carrossel, outra rede e nível sem cadeia voltam como fallback sem chamar o modelo', async () => {
    const t = tenantDb(A);
    const model = fakeModel();
    const carousel = await brief(A, 'carrossel', { format: 'carousel' });
    expect(await generateStudioPost(t, carousel, deps(model))).toMatchObject({ status: 'fallback' });
    const linkedin = await brief(A, 'só linkedin');
    await admin.query("update briefs set channels = '{linkedin}' where id = $1", [linkedin]);
    expect(await generateStudioPost(t, linkedin, deps(model))).toMatchObject({ status: 'fallback' });
    expect(model.calls).toEqual([]);
  });

  it('biblioteca vazia volta como fallback', async () => {
    const t = tenantDb(A);
    const id = await brief(A, 'sem biblioteca');
    expect(await generateStudioPost(t, id, { ...deps(fakeModel()), library: [] })).toMatchObject({ status: 'fallback' });
  });
});

describe('erros que a pessoa conserta e limite do plano', () => {
  it('conta sem perfil falha com o próximo passo, e o pedido fica failed', async () => {
    const t = tenantDb(B);
    const id = await brief(B, 'sem perfil');
    const out = await generateStudioPost(t, id, deps(fakeModel()));
    expect(out).toMatchObject({ status: 'failed' });
    expect(out.error).toContain('perfil da empresa');
    expect((await one('select status from briefs where id = $1', [id])).status).toBe('failed');
  });

  it('post com imagem de IA conta no limite do plano; o seguinte é barrado antes de gastar', async () => {
    const t = tenantDb(A);
    // Limite de 1 post com imagem por mês. Estilo que exige imagem reserva a vaga antes de gastar: o primeiro passa, o segundo é barrado.
    const first = await brief(A, 'primeiro com imagem', { style: 'auto-imagem' });
    expect(await generateStudioPost(t, first, deps(fakeModel()))).toMatchObject({ status: 'ready' });
    const second = await brief(A, 'segundo com imagem', { style: 'auto-imagem' });
    const model = fakeModel();
    expect(await generateStudioPost(t, second, deps(model))).toMatchObject({ status: 'limit', max: 1 });
    expect(model.calls).toEqual([]);
    expect((await one('select status from briefs where id = $1', [second])).status).toBe('failed');
    expect((await rows("select status from generation_runs where tenant_id = $1 and step = 'visual'", [A])).map((r) => r.status)).toEqual(['done']);
  });

  it('estilo "a Ekoai escolhe" com o mês no limite usa só modelo sem imagem e não reserva vaga', async () => {
    const t = tenantDb(A);
    const withImage = { ...template, id: 'surreal-fotografico-9', territory: 'surreal-fotografico', meta: { ...template.meta, needsImage: true, imageSlot: 'espaço livre no topo' }, html: template.html.replace('</body>', '<img src="{{asset:hero}}"></body>') };
    const id = await brief(A, 'estilo livre no limite');
    const model = fakeModel();
    const out = await generateStudioPost(t, id, { ...deps(model), library: [withImage, template] });
    expect(out).toMatchObject({ status: 'ready' });
    expect((await one('select design from post_designs where brief_id = $1', [id])).design.studio.template).toBe(template.id);
    expect((await one("select count(*)::int n from generation_runs where brief_id = $1 and step = 'visual'", [id])).n).toBe(0);
  });
});

describe('opções de design do estúdio (F4)', () => {
  // Um post do estúdio com 3 opções: o modelo pronto gera 1; as outras 2 entram como o Autoral as deixa (mesmo texto, outras peças).
  async function withOptions(idea) {
    const t = tenantDb(A);
    const id = await brief(A, idea);
    const out = await generateStudioPost(t, id, deps(fakeModel()));
    expect(out.status).toBe('ready');
    const design = await one('select id, design, png_key from post_designs where brief_id = $1', [id]);
    const main = design.design.studio.options[0];
    expect(main.pngKey).toBe(design.png_key);
    const alts = [{ pngKey: 'images/alt-1.png', htmlKey: 'images/alt-1.html', score: 7.4 }, { pngKey: 'images/alt-2.png', htmlKey: 'images/alt-2.html', score: 7.1 }];
    const options = [main, ...alts];
    await admin.query('update post_designs set design = $2 where id = $1', [design.id, { ...design.design, studio: { ...design.design.studio, options, selected: 0 } }]);
    const pending = await one('select pending_id, generation from pending_approvals where brief_id = $1', [id]);
    await admin.query('update pending_approvals set generation = $2 where pending_id = $1', [pending.pending_id, { ...pending.generation, studio: { ...pending.generation.studio, selected: 0, options: options.map((o, i) => ({ url: `https://app.test/api/media/${o.pngKey}`, score: o.score ?? null })) } }]);
    return { t, id, pendingId: pending.pending_id, designId: design.id, mainKey: main.pngKey };
  }

  it('Autoral guarda todas as opções, a escolhida primeiro, e o estúdio sem alternativas não mostra opções', async () => {
    const t = tenantDb(A);
    const id = await brief(A, 'sem alternativas');
    await generateStudioPost(t, id, deps(fakeModel()));
    const pending = await one('select generation from pending_approvals where brief_id = $1', [id]);
    expect(pending.generation.studio.selected).toBe(0);
    expect(pending.generation.studio.options).toBeUndefined();
    expect((await one('select design from post_designs where brief_id = $1', [id])).design.studio.options).toHaveLength(1);
  });

  it('escolher outra opção aponta o post para ela: imagem da pendência, png do design e o selecionado', async () => {
    const { t, pendingId, designId } = await withOptions('escolha de opção');
    const out = await chooseStudioOption(t, pendingId, 2);
    expect(out).toEqual({ selected: 2, url: 'https://app.test/api/media/images/alt-2.png' });
    const pending = await one('select images, generation from pending_approvals where pending_id = $1', [pendingId]);
    expect(pending.images).toEqual([{ id: 1, url: 'https://app.test/api/media/images/alt-2.png', path: 'images/alt-2.png' }]);
    expect(pending.generation.studio.selected).toBe(2);
    const design = await one('select png_key, design from post_designs where id = $1', [designId]);
    expect(design.png_key).toBe('images/alt-2.png');
    expect(design.design.studio).toMatchObject({ selected: 2, htmlKey: 'images/alt-2.html' });
    // Dá para voltar para a primeira: nenhuma opção se perde.
    await chooseStudioOption(t, pendingId, 0);
    expect((await one('select png_key from post_designs where id = $1', [designId])).png_key).not.toBe('images/alt-2.png');
  });

  it('opção que não existe, post já decidido e post que não é do estúdio são recusados', async () => {
    const { t, pendingId } = await withOptions('recusas');
    await expect(chooseStudioOption(t, pendingId, 3)).rejects.toThrow(/não existe/);
    await expect(chooseStudioOption(t, pendingId, -1)).rejects.toThrow(/não existe/);
    await admin.query("update pending_approvals set status = 'approved' where pending_id = $1", [pendingId]);
    await expect(chooseStudioOption(t, pendingId, 1)).rejects.toThrow(/já foi decidido/);
    await expect(chooseStudioOption(t, 'plat-inexistente', 0)).rejects.toThrow(/não encontrado/);
  });
});
