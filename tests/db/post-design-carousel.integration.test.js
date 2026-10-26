// O ajuste rápido por lâmina contra o Postgres (SPEC 023, BEZ-312): prévia e Confirmar tocam uma lâmina, só ela é
// redesenhada, a pendência e os endereços do agendamento seguem, o revisor trava título repetido, conflito de versão e
// restaurar voltam o carrossel inteiro.
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
const facts = await import('../../platform/src/lib/company-facts.ts');
const revs = await import('../../platform/src/lib/post-design-revisions.ts');
const ask = await import('../../platform/src/lib/post-design-ask.ts');
const { writeCarouselSlides } = await import('../../platform/src/lib/generation.ts');
const { pngSize } = await import('../../platform/src/lib/design/render.ts');

const A = 'it-cae-a';
const PLAN = 'it-cae-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000821', name: 'Ana', sessionVersion: 1, lastTenantId: null };
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
const CAROUSEL = { kind: 'informativo', angle: 'três sinais', slides: SLIDES, caption: 'Bolo bom não tem pressa. Três sinais para conferir. Chame no WhatsApp.', hashtags: ['bolo', 'marilia'], alt_text: 'Carrossel sobre os sinais de bolo pronto.' };

async function carouselBrief(idea, kind = null) {
  const parsed = requests.parsePostRequest({ idea, kind, format: 'carousel' });
  expect(parsed).toMatchObject({ ok: true, value: { format: 'carousel' } });
  return (await requests.createPostRequest(tenantDb(A), ANA, parsed.value)).id;
}
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Cae', 'empresa', 5, 1, 2) on conflict (id) do update set max_posts_per_month = 2", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-cae-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Cae', 'empresa', $2)", [A, PLAN]);
  const t = tenantDb(A);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itcae' } });
  await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
  await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  await facts.createFact(t, ANA, { kind: 'fact', text: 'Três sinais de bolo pronto', source: 'owner', source_note: null });
});

afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

const DEPS = { store, fontDir: FONT_DIR, mediaBaseUrl: 'https://app.test/api/media' };
let briefId;

const ctx = async () => {
  const pending = await one('select * from pending_approvals where brief_id = $1', [briefId]);
  const design = await one('select * from post_designs where id = $1', [pending.post_design_id]);
  return { pending, design };
};
const edit = (design, slide, over) => ({ ...design.slides[slide], ...over });
const editable = async (slide) => (await revs.designState(tenantDb(A), briefId, DEPS)).slides[slide].editable;

describe('ajuste rápido por lâmina', () => {
  it('o estado traz o que cada lâmina deixa ajustar', async () => {
    const t = tenantDb(A);
    const parsed = requests.parsePostRequest({ idea: 'três sinais de que o bolo está pronto', kind: 'informativo', format: 'carousel' });
    briefId = (await requests.createPostRequest(t, ANA, parsed.value)).id;
    const out = await generatePost(t, briefId, { model: fakeModel({ text: [CAROUSEL], image: [] }), store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    const state = await revs.designState(t, briefId, DEPS);
    expect(state.version).toBe(1);
    expect(state.slides.map((s) => s.role)).toEqual(['cover', 'content', 'content', 'content', 'cta']);
    expect(state.slides[1].layouts).toEqual(['lamina-item', 'titulo-destaque']);
    expect(state.slides[4].layouts).toEqual(['titulo-destaque']);
    expect(state.slides[2].editable.texts.title).toBe('O palito sai limpo');
    expect(state.editable).toEqual(state.slides[0].editable);
  });

  it('a prévia desenha só a lâmina pedida e não grava nada', async () => {
    const t = tenantDb(A);
    const before = await ctx();
    const e = await editable(2);
    const out = await revs.previewEdit(t, briefId, { baseVersion: 1, slide: 2, edit: { ...e, texts: { ...e.texts, title: 'O palito sai seco' } } }, DEPS);
    expect(out.image).toMatch(/^data:image\/png;base64,/);
    expect(out.blocking).toEqual([]);
    expect((await ctx()).design.version).toBe(before.design.version);
    expect((await ctx()).design.design).toEqual(before.design.design);
  });

  it('confirmar uma lâmina muda só o PNG dela, a pendência e o endereço no agendamento', async () => {
    const t = tenantDb(A);
    const before = await ctx();
    const e = await editable(2);
    const saved = await revs.saveEdit(t, briefId, { baseVersion: 1, slide: 2, userId: ANA.id, edit: { ...e, texts: { ...e.texts, title: 'O palito sai seco' } } }, DEPS);
    expect(saved).toMatchObject({ version: 2, summary: 'Lâmina 3: título alterado', source: 'edit' });
    expect(saved.diff.map((d) => d.field)).toEqual(['slides.2.texts.title']);

    const after = await ctx();
    expect(after.design.version).toBe(2);
    expect(after.design.design.slides[2].texts.title).toBe('O palito sai seco');
    const oldKeys = before.design.design.slides.map((s) => s.pngKey);
    const newKeys = after.design.design.slides.map((s) => s.pngKey);
    expect(newKeys.map((k, i) => k === oldKeys[i])).toEqual([true, true, false, true, true]);
    expect(after.design.png_key).toBe(before.design.png_key); // a capa não mudou
    expect(objects.has(oldKeys[2])).toBe(false);
    expect(pngSize(objects.get(newKeys[2]).bytes)).toEqual({ width: 1080, height: 1350 });
    expect(after.pending.images.map((i) => i.path)).toEqual(newKeys);
    expect(after.pending.generation.variations[0].slideUrls).toEqual(after.pending.images.map((i) => i.url));
    expect(after.pending.seed.slide_titles[2]).toBe('O palito sai seco');
    expect(after.pending.seed.design_version).toBeUndefined();
  });

  it('confirmar a capa muda o png_key do post e o gancho', async () => {
    const t = tenantDb(A);
    const before = await ctx();
    const e = await editable(0);
    await revs.saveEdit(t, briefId, { baseVersion: 2, slide: 0, userId: ANA.id, edit: { ...e, texts: { ...e.texts, title: 'Seu bolo já está pronto?' }, logoCorner: 'br' } }, DEPS);
    const after = await ctx();
    expect(after.design.png_key).not.toBe(before.design.png_key);
    expect(after.design.png_key).toBe(after.design.design.slides[0].pngKey);
    expect(after.design.design.texts.title).toBe('Seu bolo já está pronto?');
    expect(after.design.design.logoCorner).toBe('br');
    expect(after.pending.generation.variations[0].hook).toBe('Seu bolo já está pronto?');
  });

  it('o revisor trava título repetido e fora da lista de layouts da lâmina', async () => {
    const t = tenantDb(A);
    const e = await editable(1);
    await expect(revs.saveEdit(t, briefId, { baseVersion: 3, slide: 1, userId: ANA.id, edit: { ...e, texts: { ...e.texts, title: 'O palito sai seco' } } }, DEPS)).rejects.toMatchObject({ issues: [expect.objectContaining({ rule: 'slide_duplicate' })] });
    const cta = await editable(4);
    await expect(revs.previewEdit(t, briefId, { baseVersion: 3, slide: 4, edit: { ...cta, layout: 'lamina-item' } }, DEPS)).rejects.toThrow(/não serve a esta lâmina/);
    await expect(revs.previewEdit(t, briefId, { baseVersion: 3, slide: 9, edit: cta }, DEPS)).rejects.toThrow(/Escolha uma das lâminas/);
    expect((await ctx()).design.version).toBe(3);
  });

  it('trocar o layout de uma lâmina de item vale e redesenha só ela', async () => {
    const t = tenantDb(A);
    const e = await editable(1);
    const saved = await revs.saveEdit(t, briefId, { baseVersion: 3, slide: 1, userId: ANA.id, edit: { ...e, layout: 'titulo-destaque' } }, DEPS);
    expect(saved).toMatchObject({ version: 4, source: 'layout' });
    expect(saved.summary).toBe('Lâmina 2: layout trocado para título em destaque');
    expect((await ctx()).design.design.slides[1].layout).toBe('titulo-destaque');
  });

  it('versão desatualizada é conflito e nada muda', async () => {
    const t = tenantDb(A);
    const e = await editable(3);
    await expect(revs.saveEdit(t, briefId, { baseVersion: 1, slide: 3, userId: ANA.id, edit: { ...e, texts: { ...e.texts, title: 'Outro título' } } }, DEPS)).rejects.toThrow(/salvou a versão 4/);
    expect((await ctx()).design.version).toBe(4);
  });

  it('o PNG de uma versão sai da lâmina pedida', async () => {
    const t = tenantDb(A);
    const cover = await revs.revisionPng(t, briefId, 1, DEPS, 0);
    const second = await revs.revisionPng(t, briefId, 1, DEPS, 1);
    expect(cover.equals(second)).toBe(false);
    expect(pngSize(second).width).toBeGreaterThan(0);
  });

  it('voltar a uma versão antiga volta o carrossel inteiro e redesenha o que difere', async () => {
    const t = tenantDb(A);
    const saved = await revs.restoreVersion(t, briefId, { version: 1, baseVersion: 4, userId: ANA.id }, DEPS);
    expect(saved).toMatchObject({ version: 5, source: 'restore', summary: 'Voltou à versão 1' });
    const after = await ctx();
    expect(after.design.design.slides.map((s) => s.texts.title)).toEqual(SLIDES.map((s) => s.texts.title));
    expect(after.design.design.slides[1].layout).toBe('lamina-item');
    expect(after.design.design.logoCorner).toBeUndefined();
    expect(after.pending.images).toHaveLength(5);
    expect(after.pending.images.map((i) => i.path)).toEqual(after.design.design.slides.map((s) => s.pngKey));
    // as revisões guardam o design sem chaves de PNG (elas mudam a cada redesenho)
    const rev = await one('select design from post_design_revisions where post_design_id = $1 and version = 2', [after.design.id]);
    expect(rev.design.slides.every((s) => s.pngKey === undefined)).toBe(true);
  });

  it('o pedido em texto livre ainda não vale para o carrossel', async () => {
    const t = tenantDb(A);
    await expect(ask.askAdjust(t, briefId, { instruction: 'tira o subtítulo', aspect: null, baseVersion: 5, caption: 'x', hashtags: [], userId: ANA.id }, { ...DEPS, model: fakeModel({ text: [], image: [] }) })).rejects.toThrow(/não vale para carrossel/);
  });
});

describe('trocar o formato em Aprovar', () => {
  let id;
  const state = async () => revs.designState(tenantDb(A), id, DEPS);
  const fresh = async (idea, format) => {
    const t = tenantDb(A);
    const parsed = requests.parsePostRequest({ idea, kind: 'informativo', ...(format ? { format } : {}) });
    const made = (await requests.createPostRequest(t, ANA, parsed.value)).id;
    const text = format ? CAROUSEL : { kind: 'informativo', angle: 'dica', texts: { title: 'Seu bolo está pronto?', sub: 'Três sinais, sem abrir o forno' }, caption: 'Bolo bom não tem pressa. Três sinais para conferir. Chame no WhatsApp.', hashtags: ['bolo'], alt_text: 'Post sobre bolo.' };
    const out = await generatePost(t, made, { model: fakeModel({ text: [text], image: [] }), store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    return made;
  };

  it('de carrossel para uma imagem: fica a capa, as outras lâminas saem e a versão guarda o antes', async () => {
    const t = tenantDb(A);
    id = await fresh('três sinais, para trocar de formato', 'carousel');
    briefId = id;
    const before = await ctx();
    const slideKeys = before.design.design.slides.map((x) => x.pngKey);
    const saved = await revs.switchFormat(t, id, { baseVersion: 1, to: 'single', userId: ANA.id }, DEPS);
    expect(saved).toMatchObject({ version: 2, summary: 'Trocou para uma imagem' });
    expect(saved.diff).toMatchObject([{ field: 'format', before: 'carousel', after: 'single' }]);

    const after = await ctx();
    expect(after.design.design.slides).toBeUndefined();
    expect(after.design.png_key).toBe(before.design.png_key);
    expect(after.pending.images).toHaveLength(1);
    expect(after.pending.images[0].path).toBe(slideKeys[0]);
    expect(after.pending.generation.variations[0].format).toBe('single');
    expect(after.pending.generation.variations[0].slideUrls).toBeUndefined();
    expect(after.pending.generation.slide_alts).toBeUndefined();
    expect(after.pending.seed.format).toBe('single');
    expect(after.pending.seed.slides).toBeUndefined();
    expect(slideKeys.slice(1).some((k) => objects.has(k))).toBe(false);
    expect(objects.has(slideKeys[0])).toBe(true);
    expect((await one('select format from briefs where id = $1', [id])).format).toBe('single');
    const v1 = await one('select design from post_design_revisions where post_design_id = $1 and version = 1', [after.design.id]);
    expect(v1.design.slides).toHaveLength(5);
    expect((await revs.designState(t, id, DEPS)).slides).toBeUndefined();
  });

  it('de volta para carrossel: as lâminas de antes voltam sem chamar o modelo', async () => {
    const t = tenantDb(A);
    let calls = 0;
    const saved = await revs.switchFormat(t, id, { baseVersion: 2, to: 'carousel', userId: ANA.id }, { ...DEPS, writeSlides: async () => { calls += 1; return []; } });
    expect(calls).toBe(0);
    expect(saved).toMatchObject({ version: 3, summary: 'Voltou ao carrossel' });
    const after = await ctx();
    expect(after.design.design.slides.map((x) => x.texts.title)).toEqual(SLIDES.map((x) => x.texts.title));
    expect(after.pending.images).toHaveLength(5);
    expect(after.pending.generation.variations[0]).toMatchObject({ format: 'carousel' });
    expect(after.pending.generation.variations[0].slideUrls).toEqual(after.pending.images.map((i) => i.url));
    expect(after.pending.generation.slide_alts).toHaveLength(5);
    expect(after.pending.seed).toMatchObject({ format: 'carousel', slides: 5 });
    expect(after.design.png_key).toBe(after.design.design.slides[0].pngKey);
    expect((await one('select format from briefs where id = $1', [id])).format).toBe('carousel');
  });

  it('de uma imagem para carrossel sem lâminas de antes: uma chamada de texto, nenhuma de imagem, nada do limite', async () => {
    const t = tenantDb(A);
    const single = await fresh('um post de uma imagem para virar carrossel');
    const model = fakeModel({ text: [CAROUSEL], image: [] });
    const used = async () => (await one("select count(*)::int as n from generation_runs where step = 'visual' and brief_id = $1", [single])).n;
    const saved = await revs.switchFormat(t, single, { baseVersion: 1, to: 'carousel', userId: ANA.id }, { ...DEPS, writeSlides: async () => (await writeCarouselSlides(t, single, { model })).slides });
    expect(saved).toMatchObject({ version: 2, summary: 'Transformou em carrossel' });
    expect(model.calls.map((c) => c.step)).toEqual(['writer']);
    expect(model.calls[0].prompt).toContain('CARROSSEL');
    expect(await used()).toBe(0);
    const pending = await one('select * from pending_approvals where brief_id = $1', [single]);
    const design = await one('select * from post_designs where id = $1', [pending.post_design_id]);
    expect(design.design.slides).toHaveLength(5);
    expect(pending.images).toHaveLength(5);
    expect(design.png_key).toBe(pending.images[0].path);
    expect(design.design.items).toBeUndefined();
    expect((await one('select format from briefs where id = $1', [single])).format).toBe('carousel');
  });

  it('recusa o formato que o post já tem, versão velha e voltar a versão de outro formato', async () => {
    const t = tenantDb(A);
    await expect(revs.switchFormat(t, id, { baseVersion: 3, to: 'carousel', userId: ANA.id }, DEPS)).rejects.toThrow(/já é um carrossel/);
    await expect(revs.switchFormat(t, id, { baseVersion: 1, to: 'single', userId: ANA.id }, DEPS)).rejects.toThrow(/salvou a versão 3/);
    await revs.switchFormat(t, id, { baseVersion: 3, to: 'single', userId: ANA.id }, DEPS);
    await expect(revs.switchFormat(t, id, { baseVersion: 4, to: 'single', userId: ANA.id }, DEPS)).rejects.toThrow(/já é de uma imagem/);
    await expect(revs.restoreVersion(t, id, { version: 1, baseVersion: 4, userId: ANA.id }, DEPS)).rejects.toThrow(/outro formato/);
    // sem lâminas de antes e sem quem as escreva, a troca para carrossel para sem mudar nada
    const single = await fresh('outro post de uma imagem, sem escritor de lâminas');
    await expect(revs.switchFormat(t, single, { baseVersion: 1, to: 'carousel', userId: ANA.id }, DEPS)).rejects.toThrow(/Não foi possível escrever as lâminas/);
    expect((await one('select version from post_designs where brief_id = $1', [single])).version).toBe(1);
  });
});
