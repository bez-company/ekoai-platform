// O carrossel de ponta a ponta contra o Postgres (SPEC 023, ADR 0025), com modelo e bucket falsos: o pedido com
// formato carousel vira uma pendência com uma imagem por lâmina, um visual só (o da capa, usado em todas as lâminas), design.slides, e ao aprovar
// o agendamento leva as lâminas para a Meta como carrossel.
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
const { generatePost, retryNetwork } = await import('../../platform/src/lib/generation.ts');
const requests = await import('../../platform/src/lib/post-requests.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const facts = await import('../../platform/src/lib/company-facts.ts');
const scheduling = await import('../../platform/src/lib/scheduling.ts');
const { pngSize } = await import('../../platform/src/lib/design/render.ts');

const A = 'it-car-a';
const PLAN = 'it-car-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000811', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');

// Bucket de memória.
const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => { for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
};

// Modelo falso: devolve o que o teste programa e conta as chamadas. Chamada sem reserva seria um
// bug: a contagem confere isso contra generation_runs.
function fakeModel(script) {
  const calls = [];
  const directiveCalls = []; // o leitor de instruções (SPEC 020) tem roteiro à parte: `script.directives`, padrão {}
  return {
    calls,
    directiveCalls,
    config: { project: 'p', location: 'global', textModel: 'texto-falso', imageModel: 'imagem-falsa' },
    async generateJson({ prompt, labels }) {
      if (labels.step === 'directives') {
        directiveCalls.push({ labels, prompt });
        const read = script.directives ? script.directives.shift() : {};
        if (read instanceof Error) throw read;
        return { json: read ?? {}, raw: '', inputTokens: 40, outputTokens: 10, modelVersion: 'v1', durationMs: 5, costUsd: 0.00002 };
      }
      calls.push({ step: 'writer', labels, prompt });
      const next = script.text.shift();
      if (next instanceof Error) throw next;
      return { json: typeof next === 'function' ? next(prompt) : next, raw: '', inputTokens: 100, outputTokens: 50, modelVersion: 'v1', durationMs: 10, costUsd: 0.0001 };
    },
    async generateImage({ prompt, labels }) {
      calls.push({ step: 'visual', labels, prompt });
      const next = script.image.shift();
      if (next instanceof Error) throw next;
      // PNG válido de 1x1 para o render embutir
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      return { png, inputTokens: 20, outputTokens: 1120, modelVersion: 'img-1', durationMs: 20, costUsd: 0.0672 };
    },
  };
}


const slide = (title, extra = {}) => ({ texts: { title, ...extra } });
const SLIDES = [
  { role: 'cover', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Três sinais, sem abrir o forno' } },
  slide('A massa desgruda da borda', { sub: 'Passe a ponta de uma faca.' }),
  slide('O palito sai limpo'),
  slide('O topo volta ao toque'),
  slide('Quer um bolo assim?', { sub: 'Chame a gente no WhatsApp.' }),
];
const CAROUSEL = { kind: 'informativo', angle: 'três sinais', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', slides: SLIDES, caption: 'Bolo bom não tem pressa. Três sinais para conferir. Chame no WhatsApp.', hashtags: ['bolo', 'marilia'], alt_text: 'Carrossel sobre os sinais de bolo pronto.' };

async function carouselBrief(idea, kind = null) {
  const parsed = requests.parsePostRequest({ idea, kind, format: 'carousel' });
  expect(parsed).toMatchObject({ ok: true, value: { format: 'carousel' } });
  return (await requests.createPostRequest(tenantDb(A), ANA, parsed.value)).id;
}
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Car', 'empresa', 5, 1, 2) on conflict (id) do update set max_posts_per_month = 2", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-car-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Car', 'empresa', $2)", [A, PLAN]);
  const t = tenantDb(A);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itcar' } });
  await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
  await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  await facts.createFact(t, ANA, { kind: 'fact', text: 'Três sinais de bolo pronto', source: 'owner', source_note: null });
});

afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('carrossel informativo', () => {
  it('uma chamada de texto, nenhuma de imagem, e uma imagem por lâmina na pendência', async () => {
    const t = tenantDb(A);
    const id = await carouselBrief('três sinais de que o bolo está pronto', 'informativo');
    expect(await one('select format from briefs where id = $1', [id])).toEqual({ format: 'carousel' });
    const model = fakeModel({ text: [CAROUSEL], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer']);
    expect(model.calls[0].prompt).toContain('CARROSSEL');

    const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
    expect(pending.images).toHaveLength(5);
    expect(pending.images.map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
    for (const image of pending.images) {
      expect(image.url).toMatch(/^https:\/\/app\.test\/api\/media\/images\/[0-9a-f-]+\.png$/);
      expect(pngSize(objects.get(image.path).bytes)).toEqual({ width: 1080, height: 1350 });
    }
    expect(new Set(pending.images.map((i) => i.path)).size).toBe(5);
    expect(pending.generation.variations[0]).toMatchObject({ id: 1, format: 'carousel', hook: 'Seu bolo está pronto?' });
    expect(pending.generation.variations[0].slideUrls).toEqual(pending.images.map((i) => i.url));
    expect(pending.seed).toMatchObject({ format: 'carousel', slides: 5 });
    expect(pending.seed.slide_titles).toEqual(SLIDES.map((sl) => sl.texts.title));
    expect(pending.generation.slide_alts).toHaveLength(5);
    expect(pending.generation.slide_alts[1]).toMatch(/^Lâmina 2 de 5: A massa desgruda da borda\./);

    const design = await one('select * from post_designs where id = $1', [pending.post_design_id]);
    expect(design).toMatchObject({ kind: 'informativo', layout: 'titulo-destaque', visual_key: null, png_key: pending.images[0].path });
    expect(design.design.slides.map((s) => [s.role, s.layout])).toEqual([['cover', 'titulo-destaque'], ['content', 'lamina-item'], ['content', 'lamina-item'], ['content', 'lamina-item'], ['cta', 'titulo-destaque']]);
    expect(design.design.slides.map((s) => s.pngKey)).toEqual(pending.images.map((i) => i.path));
    // a capa espelha o post: o texto de cima é o da primeira lâmina
    expect(design.design.texts).toEqual(design.design.slides[0].texts);
    const runs = (await admin.query('select step from generation_runs where brief_id = $1', [id])).rows.map((r) => r.step);
    expect(runs).not.toContain('visual');
  });

  it('o revisor devolve ao modelo a lâmina que repete o título', async () => {
    const t = tenantDb(A);
    const id = await carouselBrief('três sinais, de novo', 'informativo');
    const repeated = { ...CAROUSEL, slides: [SLIDES[0], SLIDES[1], slide('A massa desgruda da borda'), SLIDES[3], SLIDES[4]] };
    const model = fakeModel({ text: [repeated, CAROUSEL], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].prompt).toContain('Lâmina 3: repete o título da lâmina 2');
  });

  it('a resposta com uma lâmina só volta ao modelo como erro de formato; sem acertar, o pedido falha', async () => {
    const t = tenantDb(A);
    const id = await carouselBrief('só uma lâmina', 'informativo');
    const one = { ...CAROUSEL, slides: [SLIDES[0]] };
    const model = fakeModel({ text: [one, one, one], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('failed');
    // a terceira volta repete o pedido da segunda (mesmo motivo): a reserva idempotente devolve a resposta gravada
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].prompt).toContain('O carrossel precisa de 2 a 10 lâminas, e vieram 1.');
  });

  it('a quantidade escolhida (SPEC 025) vai gravada no pedido, o prompt a exige e a resposta com outra quantidade volta ao modelo', async () => {
    const t = tenantDb(A);
    const parsed = requests.parsePostRequest({ idea: 'três lâminas só', kind: 'informativo', format: 'carousel', slide_count: 3 });
    expect(parsed).toMatchObject({ ok: true, value: { format: 'carousel', slideCount: 3 } });
    const { id } = await requests.createPostRequest(t, ANA, parsed.value);
    expect(await one('select format, slide_count from briefs where id = $1', [id])).toEqual({ format: 'carousel', slide_count: 3 });
    const three = { ...CAROUSEL, slides: [SLIDES[0], SLIDES[1], SLIDES[4]] };
    const model = fakeModel({ text: [CAROUSEL, three], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    expect(model.calls[0].prompt).toContain('EXATAMENTE 3 lâminas');
    expect(model.calls[1].prompt).toContain('A pessoa pediu 3 lâminas, e vieram 5.');
    const pending = await one('select p.images from pending_approvals p where p.brief_id = $1', [id]);
    expect(pending.images).toHaveLength(3);
  });

  it('sem a quantidade, o pedido guarda null e a Ekoai decide', async () => {
    const id = await carouselBrief('quantidade livre', 'informativo');
    expect((await one('select slide_count from briefs where id = $1', [id])).slide_count).toBeNull();
    await admin.query('delete from briefs where id = $1', [id]);
  });

  it('ao aprovar, o agendamento leva as lâminas como carrossel', async () => {
    const t = tenantDb(A);
    const { pending_id: pendingId } = await one("select p.pending_id from pending_approvals p join briefs b on b.id = p.brief_id where b.format = 'carousel' and b.idea = 'três sinais de que o bolo está pronto'");
    const scheduled = await scheduling.approvePending(t, { pendingId, captionId: 1, artId: 1 });
    const post = await one('select media_kind, image_url, slide_urls, variation from scheduled_posts where id = $1', [scheduled.id]);
    expect(post.media_kind).toBe('carousel');
    expect(post.slide_urls).toHaveLength(5);
    expect(post.image_url).toBe(post.slide_urls[0]);
    expect(post.variation.format).toBe('carousel');
  });
});

describe('carrossel de atmosfera', () => {
  it('um visual só, gerado uma vez e usado em todas as lâminas; o limite do plano conta 1', async () => {
    const t = tenantDb(A);
    const id = await carouselBrief('bastidor da quarta em fotos', 'atmosfera');
    const model = fakeModel({ text: [{ ...CAROUSEL, kind: 'atmosfera', visual_prompt: 'flour on a wooden table, warm light' }], image: [{}] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'visual']);
    const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
    const design = await one('select * from post_designs where id = $1', [pending.post_design_id]);
    expect(design.visual_key).toMatch(/^images\//);
    expect(design.design.slides.map((s) => s.layout)).toEqual(['foto-titulo', 'lamina-item', 'lamina-item', 'lamina-item', 'foto-titulo']);
    expect(pending.images).toHaveLength(5);
    const visuals = await one("select count(*)::int as n from generation_runs where brief_id = $1 and step = 'visual' and status = 'done'", [id]);
    expect(visuals.n).toBe(1);
  });
});

describe('pedido de uma imagem', () => {
  it('segue como era: sem format no pedido, uma imagem e nenhuma lâmina', async () => {
    const t = tenantDb(A);
    const parsed = requests.parsePostRequest({ idea: 'um post comum', kind: 'informativo' });
    expect(parsed.value.format).toBeUndefined();
    const { id } = await requests.createPostRequest(t, ANA, parsed.value);
    expect(await one('select format from briefs where id = $1', [id])).toEqual({ format: 'single' });
    const model = fakeModel({ text: [{ kind: 'informativo', angle: 'dica', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', texts: { title: 'Seu bolo está pronto?', items: ['A', 'B'] }, caption: 'Legenda boa.', hashtags: ['bolo'] }], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(model.calls[0].prompt).not.toContain('CARROSSEL');
    const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
    expect(pending.images).toHaveLength(1);
    expect(pending.generation.variations[0].format).toBe('single');
    expect((await one('select design from post_designs where id = $1', [pending.post_design_id])).design.slides).toBeUndefined();
  });
});

describe('carrossel no LinkedIn como documento em PDF (SPEC 028, BEZ-435)', () => {
  const CORE = { angle: 'Três sinais de bolo pronto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro'], proof: 'Três sinais de bolo pronto', question: 'Qual sinal você confere primeiro?' };
  const LI = { text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma e o palito sai limpo.\n\nQual sinal você confere primeiro na sua cozinha?', hashtags: ['confeitaria'], share_reason: 'Quem também faz bolo de festa responde com o sinal que confere primeiro' };
  const BASE = 'https://app.test/api/media/';
  const both = async (idea) => {
    const id = await carouselBrief(idea, 'informativo');
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    return id;
  };
  const linkedin = async (id) => (await one("select pending_id, generation, images from pending_approvals where brief_id = $1 and channel = 'linkedin'", [id]));
  const pdfOf = (variation) => objects.get(variation.documentUrl.slice(BASE.length));

  it('o LinkedIn leva um PDF com uma página por lâmina, as mesmas do Instagram', async () => {
    const t = tenantDb(A);
    const id = await both('pdf dos sinais de bolo pronto');
    const out = await generatePost(t, id, { model: fakeModel({ text: [{ ...CAROUSEL, core: CORE }, LI], image: [] }), store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');

    const li = await linkedin(id);
    const variation = li.generation.variations[0];
    expect(variation.documentUrl).toMatch(/^https:\/\/app\.test\/api\/media\/documents\/[0-9a-f-]{36}\.pdf$/);
    expect(variation.slideUrls).toHaveLength(5);
    const ig = await one("select generation from pending_approvals where brief_id = $1 and channel = 'instagram'", [id]);
    expect(variation.slideUrls).toEqual(ig.generation.variations[0].slideUrls);
    expect(ig.generation.variations[0].documentUrl).toBeUndefined();

    const pdf = pdfOf(variation);
    expect(pdf.type).toBe('application/pdf');
    const text = pdf.bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 5');
    expect(text).toContain('/MediaBox [0 0 1080 1350]');

    // ao aprovar, o agendamento do LinkedIn sai como documento
    const scheduled = await scheduling.approvePending(t, { pendingId: li.pending_id, captionId: 1, artId: 1 });
    expect(await one('select media_kind, document_url from scheduled_posts where id = $1', [scheduled.id])).toEqual({ media_kind: 'document', document_url: variation.documentUrl });
  });

  it('se o PDF não puder ser gravado, o LinkedIn sai com a capa e o post não cai', async () => {
    const t = tenantDb(A);
    const id = await both('pdf que não grava');
    const put = store.put;
    store.put = async (key, bytes, type) => {
      if (key.startsWith('documents/')) throw new Error('bucket recusou o PDF');
      return put(key, bytes, type);
    };
    try {
      const out = await generatePost(t, id, { model: fakeModel({ text: [{ ...CAROUSEL, core: CORE }, LI], image: [] }), store, fontDir: FONT_DIR });
      expect(out.status).toBe('ready');
    } finally {
      store.put = put;
    }
    const li = await linkedin(id);
    expect(li.generation.variations[0].documentUrl).toBeUndefined();
    expect(li.images).toHaveLength(1);
  });

  it('tentar de novo o LinkedIn refaz o PDF a partir das lâminas guardadas', async () => {
    const t = tenantDb(A);
    const id = await both('pdf na nova tentativa');
    expect((await generatePost(t, id, { model: fakeModel({ text: [{ ...CAROUSEL, core: CORE }, new Error('modelo fora do ar')], image: [] }), store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(await linkedin(id)).toBeUndefined();

    await retryNetwork(t, id, 'linkedin', { model: fakeModel({ text: [LI], image: [] }), store, fontDir: FONT_DIR });
    const variation = (await linkedin(id)).generation.variations[0];
    expect(variation.slideUrls).toHaveLength(5);
    expect(pdfOf(variation).bytes.toString('latin1')).toContain('/Count 5');
  });

  it('pedido de uma imagem só (sem carrossel) segue sem PDF', async () => {
    const t = tenantDb(A);
    const parsed = requests.parsePostRequest({ idea: 'uma imagem e o LinkedIn', kind: 'informativo' });
    const id = (await requests.createPostRequest(t, ANA, parsed.value)).id;
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    const single = { kind: 'informativo', angle: 'dica', signal: 'salvar', share_reason: CAROUSEL.share_reason, texts: { title: 'Seu bolo está pronto?', items: ['A massa desgruda da borda', 'O palito sai limpo'] }, caption: 'Bolo bom não tem pressa. Chame no WhatsApp.', hashtags: ['bolo'], core: CORE };
    expect((await generatePost(t, id, { model: fakeModel({ text: [single, LI], image: [] }), store, fontDir: FONT_DIR })).status).toBe('ready');
    expect((await linkedin(id)).generation.variations[0].documentUrl).toBeUndefined();
  });
});
