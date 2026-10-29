// A geração de ponta a ponta contra o Postgres (SPEC 012 entrega 5), com modelo e bucket falsos:
// pedido na fila, worker pega, texto com uma volta do revisor, visual em cache, render, pendência
// em Aprovar; limite do plano; falha e nova tentativa reaproveitando o que deu certo.
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
const { generatePost, retryNetwork, reviewSignal } = await import('../../platform/src/lib/generation.ts');
const { monthlyUsage } = await import('../../platform/src/lib/generation-db.ts');
const worker = await import('../../platform/src/lib/generation-worker.ts');
const requests = await import('../../platform/src/lib/post-requests.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const facts = await import('../../platform/src/lib/company-facts.ts');
const campaignsLib = await import('../../platform/src/lib/campaigns.ts');
const { pngSize } = await import('../../platform/src/lib/design/render.ts');

const A = 'it-flow-a';
const PLAN = 'it-flow-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000801', name: 'Ana', sessionVersion: 1, lastTenantId: null };
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

const INFO = { kind: 'informativo', angle: 'dica', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, caption: 'Bolo bom não tem pressa. Três sinais para conferir. Chame no WhatsApp.', hashtags: ['bolo', 'marilia'] };
const ATM = { kind: 'atmosfera', angle: 'bastidor', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', texts: { kicker: 'Quarta de massa', title: 'Bolo bom não tem pressa' }, caption: 'Bastidor de hoje.', hashtags: ['bastidores'], visual_prompt: 'flour on a wooden table, warm light' };

async function brief(idea, kind = null) {
  return (await requests.createPostRequest(tenantDb(A), ANA, { idea, kind })).id;
}
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Flow', 'empresa', 5, 1, 2) on conflict (id) do update set max_posts_per_month = 2", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-flow-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Flow', 'empresa', $2)", [A, PLAN]);
  const t = tenantDb(A);
  await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itflow' } });
  await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
  await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  await facts.createFact(t, ANA, { kind: 'fact', text: 'Três sinais de bolo pronto', source: 'owner', source_note: null });
});

afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('post informativo', () => {
  it('o revisor devolve a palavra proibida ao modelo e a segunda versão vira pendência com PNG', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    const model = fakeModel({ text: [{ ...INFO, caption: 'Oferta imperdível de bolo' }, INFO], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'writer']);
    expect(model.calls[1].prompt).toContain('"imperdível"');
    expect(model.calls[0].labels).toEqual({ tenant: A, step: 'writer', brief: id });

    const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
    expect(pending.channel).toBe('instagram');
    expect(pending.post_kind).toBe('informativo');
    expect(pending.generation.variations[0]).toMatchObject({ id: 1, hook: 'Seu bolo está pronto?', hashtags: ['bolo', 'marilia'] });
    expect(pending.images[0].url).toMatch(/^https:\/\/app\.test\/api\/media\/images\/[0-9a-f-]+\.png$/);
    const png = objects.get(pending.images[0].path).bytes;
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 });
    const design = await one('select * from post_designs where id = $1', [pending.post_design_id]);
    expect(design).toMatchObject({ kind: 'informativo', layout: 'lista-numerada', visual_key: null });
    expect(design.design.texts.title).toBe('Seu bolo está pronto?');
    expect((await one('select status, error from briefs where id = $1', [id]))).toEqual({ status: 'ready', error: null });
    const runs = (await admin.query("select step, status, cost_usd from generation_runs where brief_id = $1 order by created_at", [id])).rows;
    expect(runs.map((r) => [r.step, r.status])).toEqual([['directives', 'done'], ['writer', 'done'], ['writer', 'done']]);
    expect((await admin.query("select title, audience from notifications where tenant_id = $1 and kind = 'post.ready'", [A])).rows).toHaveLength(1);
    // rodar de novo o mesmo pedido não chama o modelo nem cria outra pendência
    const again = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(again).toEqual(out);
    expect(model.calls).toHaveLength(2);
  });

  it('objetivo e formato do pedido (SPEC 017): o objetivo vai ao prompt e o 1:1 sai 1080x1080', async () => {
    const t = tenantDb(A);
    const parsed = requests.parsePostRequest({ idea: 'qual sabor vocês preferem', goal: 'conversa', ratio: '1:1' });
    expect(parsed).toEqual({ ok: true, value: { idea: 'qual sabor vocês preferem', kind: 'informativo', goal: 'conversa', ratio: '1:1' } });
    const { id } = await requests.createPostRequest(t, ANA, parsed.value);
    expect(await one('select goal, ratio, post_kind from briefs where id = $1', [id])).toEqual({ goal: 'conversa', ratio: '1:1', post_kind: 'informativo' });
    const model = fakeModel({ text: [{ ...INFO, items: undefined, texts: { title: 'Ninho ou morango?' } }], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    expect(model.calls[0].prompt).toContain('Objetivo do post: puxar conversa');
    const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
    expect(pngSize(objects.get(pending.images[0].path).bytes)).toEqual({ width: 1080, height: 1080 });
    expect(pending.seed).toMatchObject({ goal: 'conversa', ratio: '1:1' });
    expect(await one('select ratio from post_designs where id = $1', [pending.post_design_id])).toEqual({ ratio: '1:1' });
    expect(await requests.postProgress(t, id)).toMatchObject({ goal: 'conversa', ratio: '1:1' });
    // pedido antigo, sem objetivo nem formato: retrato 4:5 e sem objetivo
    const old = await brief('pedido sem objetivo');
    expect(await one('select goal, ratio from briefs where id = $1', [old])).toEqual({ goal: null, ratio: '4:5' });
    await expect(admin.query("update briefs set ratio = '9:16' where id = $1", [old])).rejects.toThrow(/check/);
  });

  it('o andamento lê a fila, as etapas e a pendência', async () => {
    const t = tenantDb(A);
    const { id } = (await admin.query("select id from briefs where tenant_id = $1 and status = 'ready' limit 1", [A])).rows[0];
    const progress = await requests.postProgress(t, id);
    expect(progress).toMatchObject({ status: 'ready', kind: 'informativo', step: 'writer' });
    expect(progress.pendingId).toMatch(/^plat-/);
  });
});

describe('post de atmosfera, limite e nova tentativa', () => {
  it('gera o visual uma vez (cache por hash), conta no limite e respeita o teto do plano', async () => {
    const t = tenantDb(A);
    const id1 = await brief('bastidor da cozinha', 'atmosfera');
    const model = fakeModel({ text: [ATM, ATM, ATM], image: [{}, {}, {}] });
    const out1 = await generatePost(t, id1, { model, store, fontDir: FONT_DIR });
    expect(out1.status, JSON.stringify(out1)).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'visual']);
    expect(model.calls[1].prompt).toContain('No text, no letters');
    const design = await one('select visual_key, layout from post_designs where brief_id = $1', [id1]);
    expect(design.layout).toBe('foto-titulo');
    expect(objects.has(design.visual_key)).toBe(true);

    // mesmo pedido de visual noutro brief: cache, sem chamada e sem contar de novo
    const id2 = await brief('bastidor da cozinha de novo', 'atmosfera');
    await generatePost(t, id2, { model, store, fontDir: FONT_DIR });
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'visual', 'writer', 'visual']);
    expect((await admin.query("select count(*)::int as n from generation_runs where tenant_id = $1 and step = 'visual'", [A])).rows[0].n).toBe(2);

    // o plano de teste permite 2 por mês: o terceiro visual diferente bate no limite
    const id3 = await brief('outro clima', 'atmosfera');
    const other = fakeModel({ text: [{ ...ATM, visual_prompt: 'a different scene' }], image: [{}] });
    const out3 = await generatePost(t, id3, { model: other, store, fontDir: FONT_DIR });
    expect(out3).toEqual({ status: 'limit', briefId: id3, max: 2 });
    expect(other.calls.map((c) => c.step)).toEqual(['writer']);
    expect(await one('select status, error from briefs where id = $1', [id3])).toMatchObject({ status: 'failed', error: expect.stringContaining('limite') });
  });

  it('falha no modelo marca o pedido; tentar de novo reaproveita o texto que deu certo', async () => {
    const t = tenantDb(A);
    await admin.query("update plans set max_posts_per_month = 10 where id = $1", [PLAN]);
    const id = await brief('festa de aniversário', 'atmosfera');
    const broken = fakeModel({ text: [ATM], image: [new Error('Vertex AI 503 em imagem-falsa: indisponível')] });
    const out = await generatePost(t, id, { model: broken, store, fontDir: FONT_DIR });
    expect(out).toMatchObject({ status: 'failed', error: expect.stringContaining('Não deu para concluir') });
    expect(await one('select status from briefs where id = $1', [id])).toEqual({ status: 'failed' });
    expect((await admin.query("select step, status from generation_runs where brief_id = $1 order by created_at", [id])).rows).toEqual([{ step: 'directives', status: 'done' }, { step: 'writer', status: 'done' }, { step: 'visual', status: 'failed' }]);

    await requests.retryPostRequest(t, id);
    expect(await one('select status from briefs where id = $1', [id])).toEqual({ status: 'queued' });
    const fixed = fakeModel({ text: [new Error('não deveria chamar o texto de novo')], image: [{}] });
    const claimed = await worker.claimQueued(5);
    expect(claimed.map((c) => c.id)).toContain(id);
    const summary = await worker.runGenerateQueue({ model: fixed, store, fontDir: FONT_DIR, critic: false });
    expect(summary.claimed).toBe(0); // o claim de cima já tinha pegado; o worker de verdade faz os dois juntos
    const retry = await generatePost(t, id, { model: fixed, store, fontDir: FONT_DIR });
    expect(retry.status, JSON.stringify(retry)).toBe('ready');
    expect(fixed.calls.map((c) => c.step)).toEqual(['visual']);
  });

  it('"outra direção" reenfileira com o contador avançado, tira a pendência da fila e muda o prompt', async () => {
    const t = tenantDb(A);
    const { id } = (await admin.query("select b.id from briefs b join pending_approvals p on p.brief_id = b.id where b.tenant_id = $1 and b.post_kind = 'atmosfera' limit 1", [A])).rows[0];
    await requests.requestAnotherDirection(t, id);
    expect(await one('select direction, status from briefs where id = $1', [id])).toEqual({ direction: 2, status: 'queued' });
    expect((await admin.query('select count(*)::int as n from pending_approvals where brief_id = $1', [id])).rows[0].n).toBe(0);
    const model = fakeModel({ text: [{ ...ATM, visual_prompt: 'a new scene for direction two' }], image: [{}] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(model.calls[0].prompt).toContain('Direção 2');
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'visual']);
    await expect(requests.requestAnotherDirection(tenantDb('it-flow-nope'), id)).rejects.toThrow(/não encontrado/);
  });

  it('o atalho de legenda reescreve e passa pelo revisor', async () => {
    const t = tenantDb(A);
    const { id } = (await admin.query("select id from briefs where tenant_id = $1 and status = 'ready' limit 1", [A])).rows[0];
    const model = fakeModel({ text: [{ caption: 'Curta e boa.', hashtags: ['bolo'] }, { caption: 'Oferta imperdível', hashtags: [] }], image: [] });
    const { rewriteCaption } = await import('../../platform/src/lib/generation.ts');
    expect(await rewriteCaption(t, { model }, { briefId: id, mode: 'shorter', caption: 'Uma legenda longa demais para o feed.', hashtags: ['bolo'] })).toEqual({ caption: 'Curta e boa.', hashtags: ['bolo'] });
    await expect(rewriteCaption(t, { model }, { briefId: id, mode: 'casual', caption: 'Outra', hashtags: [] })).rejects.toThrow(/não passou no revisor/);
    expect(model.calls.map((c) => c.labels.step)).toEqual(['rewrite', 'rewrite']);
  });

  it('o worker pega a fila com skip locked e devolve o resumo', async () => {
    const t = tenantDb(A);
    const id = await brief('promoção de natal', 'informativo');
    const model = fakeModel({ text: [INFO], image: [] });
    const summary = await worker.runGenerateQueue({ model, store, fontDir: FONT_DIR, critic: false }, { limit: 5 });
    expect(summary, JSON.stringify(summary.outcomes)).toMatchObject({ claimed: 1, ready: 1, failed: 0, limit: 0 });
    expect(summary.outcomes[0]).toMatchObject({ status: 'ready', briefId: id });
    expect(await worker.claimQueued(5)).toEqual([]);
    expect(await requests.retryPostRequest(t, id).catch((e) => e.message)).toMatch(/não está com falha/);
  });
});

describe('fato que não vale (SPEC 018, ADR 0019)', () => {
  const CAPTION = 'Bolo de pote por R$ 18 só hoje';

  it('número que só existe em fato vencido não segue para Aprovar: o pedido falha com o motivo; renovado o fato, passa', async () => {
    const t = tenantDb(A);
    await admin.query(
      "insert into company_facts (tenant_id, kind, text, status, verified_at, valid_until, category) values ($1, 'fact', 'Bolo de pote de ninho por R$ 18', 'confirmed', now(), '2026-01-15', 'oferta_preco')",
      [A],
    );
    const stale = await brief('promoção do bolo de pote', 'informativo');
    const model = fakeModel({ text: [{ ...INFO, caption: CAPTION }, { ...INFO, caption: CAPTION }, { ...INFO, caption: CAPTION }], image: [] });
    const out = await generatePost(t, stale, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('O número 18 vem de um fato vencido em 15/01: "Bolo de pote de ninho por R$ 18". Confirme ou atualize o fato para usá-lo.');
    // a terceira volta repete o prompt da segunda: a reserva idempotente devolve a linha gravada, sem chamar o modelo
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'writer']);
    expect((await one('select status from briefs where id = $1', [stale])).status).toBe('failed');
    expect((await admin.query('select id from pending_approvals where brief_id = $1', [stale])).rows).toEqual([]);
    // o prompt nunca recebeu o fato vencido
    expect(model.calls[0].prompt).not.toContain('Bolo de pote de ninho por R$ 18');

    await admin.query("update company_facts set valid_until = '2999-01-01' where tenant_id = $1 and text like 'Bolo de pote de ninho%'", [A]);
    const fresh = await brief('promoção do bolo de pote', 'informativo');
    const ok = await generatePost(t, fresh, { model: fakeModel({ text: [{ ...INFO, caption: CAPTION }], image: [] }), store, fontDir: FONT_DIR });
    expect(ok.status).toBe('ready');
  });
});

describe('campanha do pedido (SPEC 018)', () => {
  it('o prompt leva a campanha; o número da oferta passa; a restrição vira "nunca diga" e o revisor devolve ao modelo', async () => {
    const t = tenantDb(A);
    const campaign = await campaignsLib.createCampaign(t, ANA, {
      name: 'Encomendas de fim de ano',
      kind: 'vender',
      objective: 'Vender as caixas de fim de ano',
      offering: 'Caixas de panetone por R$ 89',
      audience: 'Famílias que dão presente',
      cta: 'dm',
      restrictions: ['desconto'],
      target_label: null,
      target_value: null,
      posts_per_week: null,
      start_date: '2026-10-12',
      end_date: '2026-12-15',
    });
    const id = (await requests.createPostRequest(t, ANA, { idea: 'a caixa de panetone de Natal', kind: 'informativo', campaignId: campaign.id })).id;
    expect((await one('select campaign_id from briefs where id = $1', [id])).campaign_id).toBe(campaign.id);
    const model = fakeModel({ text: [{ ...INFO, caption: 'Caixa de panetone por R$ 89, com desconto de Natal' }, { ...INFO, caption: 'Caixa de panetone por R$ 89 para presentear' }], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status, JSON.stringify(out)).toBe('ready');
    expect(model.calls).toHaveLength(2);
    const first = model.calls[0].prompt;
    expect(first).toContain('## A campanha deste post: Encomendas de fim de ano');
    expect(first).toContain('(vale como afirmado só para esta campanha): Caixas de panetone por R$ 89');
    expect(first).toContain('Nunca diga nesta campanha: desconto');
    expect(first).toContain('convide a pessoa a mandar mensagem direta'); // a chamada da campanha vale no lugar da do perfil
    expect(first).not.toContain('chamar no WhatsApp');
    // a primeira legenda disse "desconto": o revisor devolve o motivo ao modelo
    expect(model.calls[1].prompt).toContain('"desconto" está na lista do que a empresa nunca afirma.');
    const pending = await one('select generation from pending_approvals where brief_id = $1', [id]);
    expect(JSON.stringify(pending.generation)).toContain('R$ 89');
  });

  it('um pedido sem campanha não leva nada dela, e a campanha apagada deixa o post sair como um post normal', async () => {
    const t = tenantDb(A);
    const model = fakeModel({ text: [INFO], image: [] });
    const plain = await brief('dica de bolo', 'informativo');
    expect((await generatePost(t, plain, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls[0].prompt).not.toContain('## A campanha deste post');
    const campaign = (await campaignsLib.listCampaigns(t))[0];
    const withCampaign = (await requests.createPostRequest(t, ANA, { idea: 'dica de bolo', kind: 'informativo', campaignId: campaign.id })).id;
    await admin.query('delete from campaigns where id = $1', [campaign.id]); // a FK solta o pedido (set null)
    const model2 = fakeModel({ text: [INFO], image: [] });
    expect((await generatePost(t, withCampaign, { model: model2, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model2.calls[0].prompt).not.toContain('## A campanha deste post');
  });
});

describe('instruções do pedido (SPEC 020)', () => {
  it('lidas uma vez, no contrato; o texto literal que não está no pedido cai; ficam no pedido e não são lidas de novo', async () => {
    const t = tenantDb(A);
    const id = await brief('Capa: fundo escuro, logo no centro e a frase "Aberto de terça a sábado". Mais nada.', 'informativo');
    const read = { background: 'dark', elements: { logo: 'c', rodape: 'br', handle: 'xx' }, exact_texts: ['Aberto de terça a sábado', 'Frase que não está no pedido'], text_only: true, items_count: 12, extra: 'x' };
    const model = fakeModel({ text: [INFO], image: [], directives: [read] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(model.directiveCalls).toHaveLength(1);
    expect(model.directiveCalls[0].labels).toEqual({ tenant: A, step: 'directives', brief: id });
    expect(model.directiveCalls[0].prompt).toContain('fundo escuro, logo no centro');
    expect((await one('select directives from briefs where id = $1', [id])).directives).toEqual({ status: 'ok', directives: { background: 'dark', elements: { logo: 'c' }, exactTexts: ['Aberto de terça a sábado'], textOnly: true } });
    const run = await one("select status, cost_usd::float as cost from generation_runs where brief_id = $1 and step = 'directives'", [id]);
    expect(run).toEqual({ status: 'done', cost: 0.00002 });
    // a leitura não conta no limite do plano (só o visual conta)
    expect((await one("select count(*)::int as n from generation_runs where brief_id = $1 and step = 'visual'", [id])).n).toBe(0);
    // rodar de novo o mesmo pedido não lê outra vez
    await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(model.directiveCalls).toHaveLength(1);
  });

  it('pedido sem instrução fica com {}; leitor que falha duas vezes não derruba o post e fica registrado', async () => {
    const t = tenantDb(A);
    const plain = await brief('como saber se o bolo está pronto', 'informativo');
    const ok = fakeModel({ text: [INFO], image: [] });
    expect((await generatePost(t, plain, { model: ok, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect((await one('select directives from briefs where id = $1', [plain])).directives).toEqual({ status: 'ok', directives: {} });

    const failing = await brief('outra ideia de bolo', 'informativo');
    const broken = fakeModel({ text: [INFO], image: [], directives: [new Error('Vertex AI 503'), new Error('Vertex AI 503')] });
    const out = await generatePost(t, failing, { model: broken, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(broken.directiveCalls).toHaveLength(2);
    expect((await one('select directives from briefs where id = $1', [failing])).directives).toEqual({ status: 'failed', directives: {} });
  });
});

describe('o código obedece as instruções do pedido (SPEC 020, entrega c)', () => {
  const INFO4 = { ...INFO, texts: { ...INFO.texts, items: [...INFO.texts.items, 'Quarto item que passou do pedido'] } };
  const readOf = (read) => ({ directives: [read] });
  const designOf = async (briefId) => one('select pd.layout, pd.design, b.post_kind from post_designs pd join briefs b on b.id = pd.brief_id where pd.brief_id = $1', [briefId]);

  it('cartão de marca: sem foto, sem chamar o modelo de imagem, só o que foi pedido; logo que a conta não tem vira "não aplicado"', async () => {
    const t = tenantDb(A);
    await admin.query('update plans set max_posts_per_month = 50 where id = $1', [PLAN]);
    const id = await brief('Capa: fundo escuro, logo no centro, o nome da empresa e o @ no canto.', 'atmosfera');
    const model = fakeModel({ text: [INFO], image: [], ...readOf({ background: 'dark', elements: { logo: 'c', name: 'bc', handle: 'br' } }) });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer']); // nenhuma chamada de imagem
    expect(model.calls[0].prompt).toContain('cartão de marca liso, sem foto');
    const d = await designOf(id);
    expect(d.layout).toBe('marca');
    expect(d.post_kind).toBe('informativo');
    expect(d.design).toMatchObject({ layout: 'marca', background: 'dark', brandName: 'It Flow', placements: { name: 'bc', handle: 'br' }, texts: { title: '' } });
    expect(d.design.placements.logo).toBeUndefined();
    const pending = await one('select generation from pending_approvals where brief_id = $1', [id]);
    expect(pending.generation.directives.status).toBe('ok');
    expect(pending.generation.directives.applied).toEqual(['Fundo escuro', 'O nome da empresa: base, no centro', 'O @: canto inferior direito']);
    expect(pending.generation.directives.notApplied).toEqual([{ what: 'O logo', why: expect.stringContaining('não tem logo cadastrado') }]);
    expect(pending.generation.directives.items).toEqual([
      { text: 'Fundo escuro', ok: true },
      { text: 'O logo: centro', ok: false, why: expect.stringContaining('não tem logo cadastrado') },
      { text: 'O nome da empresa: base, no centro', ok: true },
      { text: 'O @: canto inferior direito', ok: true },
    ]);
    expect((await one("select count(*)::int as n from generation_runs where brief_id = $1 and step = 'visual'", [id])).n).toBe(0);
  });

  it('texto exato e "mais nada": a frase entra como está e o redator não põe selo, subtítulo nem itens', async () => {
    const t = tenantDb(A);
    const id = await brief('Quero a frase "Fornada nova todo dia às 7h" e mais nada.', 'informativo');
    const model = fakeModel({ text: [INFO], image: [], ...readOf({ exact_texts: ['Fornada nova todo dia às 7h'], text_only: true }) });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls[0].prompt).toContain('"Fornada nova todo dia às 7h"');
    const d = await designOf(id);
    expect(d.layout).toBe('titulo-destaque');
    expect(d.design.texts).toEqual({ title: 'Fornada nova todo dia às 7h' });
    const pending = await one('select generation, images from pending_approvals where brief_id = $1', [id]);
    expect(pending.generation.directives).toMatchObject({ status: 'ok', applied: ['Texto exato: "Fornada nova todo dia às 7h"', 'Mais nada de texto na imagem'], notApplied: [] });
    expect(pending.generation.guardrail_flags).not.toContain('directive_text_missing');
  });

  it('quantidade pedida: o revisor devolve o número ao modelo e a segunda versão vem com a quantidade certa', async () => {
    const t = tenantDb(A);
    const id = await brief('Três dicas para o bolo crescer', 'informativo');
    const model = fakeModel({ text: [INFO4, INFO], image: [], ...readOf({ items_count: 3 }) });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'writer']);
    expect(model.calls[0].prompt).toContain('EXATAMENTE 3 itens');
    expect(model.calls[1].prompt).toContain('A pessoa pediu 3 itens e o texto trouxe 4');
    expect((await designOf(id)).design.texts.items).toHaveLength(3);
  });

  it('logo no canto e logo escondido valem nas famílias de sempre; regra da marca não passa por cima do pedido', async () => {
    const t = tenantDb(A);
    const id = await brief('Post com o logo escondido: dicas do bolo', 'informativo');
    const model = fakeModel({ text: [INFO], image: [], ...readOf({ elements: { logo: 'off' } }) });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    const d = await designOf(id);
    expect(d.layout).toBe('lista-numerada');
    expect(d.design.logoHidden).toBe(true);
    expect(d.design.rules).toBeUndefined();
  });

  it('atmosfera com "sem texto": a foto é gerada e fica sem título; a posição do @ sobre a foto é dita como não aplicada', async () => {
    const t = tenantDb(A);
    const id = await brief('Foto do bastidor da cozinha, sem nenhum texto, só o @ em um canto.', 'atmosfera');
    const model = fakeModel({ text: [ATM], image: [{}], ...readOf({ text_only: true, elements: { handle: 'bl' } }) });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls.map((c) => c.step)).toEqual(['writer', 'visual']);
    const d = await designOf(id);
    expect(d.layout).toBe('foto-titulo');
    expect(d.design.texts.title).toBe('');
    const pending = await one('select generation from pending_approvals where brief_id = $1', [id]);
    expect(pending.generation.directives.notApplied.map((n) => n.what)).toEqual(['O @']);
    expect(pending.generation.directives.applied).toEqual(['Mais nada de texto na imagem']);
  });

  it('pedido sem instrução não muda nada: sem família nova e sem painel de instruções', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto de verdade', 'informativo');
    const model = fakeModel({ text: [INFO], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect((await designOf(id)).layout).toBe('lista-numerada');
    expect((await one('select generation from pending_approvals where brief_id = $1', [id])).generation.directives).toBeUndefined();
  });
});

describe('pedido para mais de uma rede (SPEC 028)', () => {
  const CORE = { angle: 'Três sinais de bolo pronto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro'], proof: 'Três sinais de bolo pronto', question: 'Qual sinal você confere primeiro?' };

  it('o pedido comum fica só no Instagram, sem núcleo e sem pedir núcleo ao modelo', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    const model = fakeModel({ text: [INFO], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls[0].prompt).not.toContain('- core:');
    expect(await one('select channels, core from briefs where id = $1', [id])).toEqual({ channels: ['instagram'], core: null });
  });

  it('com outra rede, o núcleo é pedido, guardado no pedido e o sinal vai para a pendência', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    const model = fakeModel({ text: [{ ...INFO, core: CORE }], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls[0].prompt).toContain('- core:');
    expect(await one('select channels, core from briefs where id = $1', [id])).toEqual({ channels: ['instagram', 'linkedin'], core: CORE });
    const pending = await one('select generation from pending_approvals where brief_id = $1', [id]);
    expect(pending.generation).toMatchObject({ signal: 'salvar', share_reason: expect.stringContaining('guarda os sinais') });
  });

  it('resposta sem núcleo volta ao modelo com o motivo e a segunda versão passa', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{instagram,twitter}' where id = $1", [id]);
    const model = fakeModel({ text: [INFO, { ...INFO, core: CORE }], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].prompt).toContain('O modelo não devolveu o núcleo da ideia');
    expect((await one('select core from briefs where id = $1', [id])).core).toEqual(CORE);
  });

  it('o banco recusa rede fora da lista, lista vazia e núcleo que não é objeto', async () => {
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await expect(admin.query("update briefs set channels = '{tiktok}' where id = $1", [id])).rejects.toThrow(/briefs_channels_check/);
    await expect(admin.query("update briefs set channels = '{}' where id = $1", [id])).rejects.toThrow(/briefs_channels_check/);
    await expect(admin.query("update briefs set core = '[1]'::jsonb where id = $1", [id])).rejects.toThrow(/briefs_core_check/);
    await expect(admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, channel) values ($1, $2, 'adapt', repeat('a', 64), 'tiktok')", [A, id])).rejects.toThrow(/generation_runs_channel_check/);
    await admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, channel, status) values ($1, $2, 'adapt', repeat('b', 64), 'linkedin', 'failed')", [A, id]);
  });
});

describe('post do LinkedIn a partir do núcleo (SPEC 028, BEZ-424)', () => {
  const CORE = { angle: 'Três sinais de bolo pronto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro'], proof: 'Três sinais de bolo pronto', question: 'Qual sinal você confere primeiro?' };
  const LI = { text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma e o palito sai limpo.\n\nQual sinal você confere primeiro na sua cozinha?', hashtags: ['confeitaria'], share_reason: 'Quem também faz bolo de festa responde com o sinal que confere primeiro' };
  const both = async (idea = 'como saber se o bolo está pronto') => {
    const id = await brief(idea, 'informativo');
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    return id;
  };

  it('o pedido gera as duas pendências, com o texto do núcleo, a mesma arte e o custo por rede', async () => {
    const t = tenantDb(A);
    const id = await both();
    const model = fakeModel({ text: [{ ...INFO, core: CORE }, LI], image: [] });
    const notified = async () => (await admin.query("select count(*)::int as n from notifications where tenant_id = $1 and kind = 'post.ready'", [A])).rows[0].n;
    const before = await notified();
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls.map((c) => c.labels.step)).toEqual(['writer', 'adapt']);
    // uma ideia, uma notificação (não uma por rede)
    expect((await notified()) - before).toBe(1);
    // o LinkedIn lê o núcleo, não a legenda do Instagram
    expect(model.calls[1].prompt).toContain('A massa desgruda da borda');
    expect(model.calls[1].prompt).not.toContain(INFO.caption);

    const rows = (await admin.query('select channel, post_design_id, visual_mode, post_kind, generation, images from pending_approvals where brief_id = $1 order by channel', [id])).rows;
    expect(rows.map((r) => r.channel)).toEqual(['instagram', 'linkedin']);
    expect(rows[0].post_design_id).toBe(rows[1].post_design_id);
    expect(rows[1].visual_mode).toBe('shared');
    expect(rows[1].images).toHaveLength(1);
    expect(rows[1].images[0].path).toBe(rows[0].images[0].path);
    const li = rows[1].generation;
    expect(li).toMatchObject({ signal: 'responder', angle: CORE.angle, share_reason: LI.share_reason });
    expect(li.variations[0]).toMatchObject({ id: 1, format: 'single', hashtags: ['confeitaria'], hook: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma e o palito sai limpo.' });
    expect(li.variations[0].body.endsWith('\n\n#confeitaria')).toBe(true);

    const runs = (await admin.query("select step, channel, status from generation_runs where brief_id = $1 and step in ('writer', 'adapt') order by created_at", [id])).rows;
    expect(runs).toEqual([{ step: 'writer', channel: 'instagram', status: 'done' }, { step: 'adapt', channel: 'linkedin', status: 'done' }]);
  });

  it('palavra proibida no LinkedIn volta ao modelo, e a segunda versão passa (duas chamadas de adapt)', async () => {
    const t = tenantDb(A);
    const id = await both();
    const model = fakeModel({ text: [{ ...INFO, core: CORE }, { ...LI, text: LI.text.replace('erro mais caro', 'erro imperdível') }, LI], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR })).status).toBe('ready');
    expect(model.calls.map((c) => c.labels.step)).toEqual(['writer', 'adapt', 'adapt']);
    expect(model.calls[2].prompt).toContain('"imperdível"');
    const li = await one("select generation from pending_approvals where brief_id = $1 and channel = 'linkedin'", [id]);
    expect(li.generation.variations[0].body).toContain('erro mais caro');
    expect((await admin.query("select count(*)::int as n from generation_runs where brief_id = $1 and step = 'adapt' and channel = 'linkedin'", [id])).rows[0].n).toBe(2);
  });

  it('o LinkedIn que falha não derruba o Instagram: o pedido fica pronto e a falha fica registrada', async () => {
    const t = tenantDb(A);
    const id = await both();
    const model = fakeModel({ text: [{ ...INFO, core: CORE }, new Error('modelo fora do ar')], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    expect((await admin.query('select channel from pending_approvals where brief_id = $1', [id])).rows).toEqual([{ channel: 'instagram' }]);
    expect(await one('select status, error from briefs where id = $1', [id])).toEqual({ status: 'ready', error: null });
    expect(await one("select status, error from generation_runs where brief_id = $1 and step = 'adapt'", [id])).toEqual({ status: 'failed', error: 'modelo fora do ar' });
  });

  it('pedido só do LinkedIn: o Instagram não vira pendência e o aviso leva ao LinkedIn', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{linkedin}' where id = $1", [id]);
    const model = fakeModel({ text: [{ ...INFO, core: CORE }, LI], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('ready');
    const rows = (await admin.query('select pending_id, channel from pending_approvals where brief_id = $1', [id])).rows;
    expect(rows.map((r) => r.channel)).toEqual(['linkedin']);
    expect(out.pendingId).toBe(rows[0].pending_id);
  });

  it('pedido só do LinkedIn que falha não fica "pronto" sem post: o pedido falha com o motivo', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{linkedin}' where id = $1", [id]);
    const model = fakeModel({ text: [{ ...INFO, core: CORE }, new Error('modelo fora do ar')], image: [] });
    const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('O texto do LinkedIn não saiu agora. Tente de novo em instantes.');
    expect((await admin.query('select 1 from pending_approvals where brief_id = $1', [id])).rows).toHaveLength(0);
    expect((await one('select status from briefs where id = $1', [id])).status).toBe('failed');
  });

  it('o pedido só do Instagram não chama o redator do LinkedIn', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    const model = fakeModel({ text: [INFO], image: [] });
    await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(model.calls.map((c) => c.labels.step)).toEqual(['writer']);
    expect((await admin.query('select channel from pending_approvals where brief_id = $1', [id])).rows).toEqual([{ channel: 'instagram' }]);
  });
});

describe('avaliador de sinais (SPEC 028, BEZ-425)', () => {
  const CAPTION = 'Salve este post: três sinais para conferir o bolo. Chame no WhatsApp.';
  const POST = { ...INFO, caption: CAPTION };
  const CORE = { angle: 'Três sinais de bolo pronto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro'], proof: 'Três sinais de bolo pronto', question: 'Qual sinal você confere primeiro?' };
  const LI = { text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma.\n\nQual sinal você confere primeiro na sua cozinha?', hashtags: [], share_reason: 'Quem também faz bolo de festa responde com o sinal que confere primeiro' };
  const IG_IDS = ['envio', 'salvamento', 'gancho', 'fato', 'chamada'];
  const IG_QUOTES = ['Salve este post', 'três sinais para conferir', 'Seu bolo está pronto', 'o bolo', 'Chame no WhatsApp'];
  const LI_IDS = ['gancho', 'especificidade', 'leitura', 'pergunta', 'voz'];
  const LI_QUOTES = ['O erro mais caro de uma confeitaria', 'Eu só abro a porta quando a borda descola', 'borda descola da forma', 'Qual sinal você confere primeiro', 'Eu só abro a porta'];
  const critic = (ids, quotes, scores) => ({ criteria: ids.map((id, i) => ({ id, score: scores[i], evidence: scores[i] ? quotes[i] : 'falta algo', suggestion: scores[i] === 2 ? null : 'Acrescente o fato: Entregamos no mesmo dia em Marília.' })) });
  const STRONG = [2, 2, 2, 1, 2];
  const FIXED = { text: 'Salve este post: três sinais para conferir o bolo. Entregamos no mesmo dia em Marília.' };
  const steps = (model) => model.calls.map((c) => c.labels.step);
  const generation = async (id, channel = 'instagram') => (await one('select generation from pending_approvals where brief_id = $1 and channel = $2', [id, channel])).generation;

  it('avalia o post do Instagram, guarda a avaliação na pendência e registra a chamada com a rede', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    const model = fakeModel({ text: [POST, critic(IG_IDS, IG_QUOTES, STRONG)], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR, critic: true })).status).toBe('ready');
    expect(steps(model)).toEqual(['writer', 'critic']);
    expect(model.calls[1].prompt).toContain(CAPTION);
    const g = await generation(id);
    expect(g.critic).toMatchObject({ channel: 'instagram', band: 'forte' });
    expect(g.critic.fixed).toBeUndefined();
    expect(g.critic.criteria.map((c) => c.id)).toEqual(IG_IDS);
    expect(g.variations[0].body).toBe(CAPTION);
    expect(await one("select step, channel, status from generation_runs where brief_id = $1 and step = 'critic'", [id])).toEqual({ step: 'critic', channel: 'instagram', status: 'done' });
  });

  it('nota 0 com sugestão: um conserto, nova avaliação melhor, e a legenda nova vai para a pendência', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    const model = fakeModel({ text: [POST, critic(IG_IDS, IG_QUOTES, [2, 2, 2, 0, 2]), FIXED, critic(IG_IDS, ['Salve este post', 'três sinais para conferir', 'Seu bolo está pronto', 'Entregamos no mesmo dia em Marília', 'Salve este post'], [2, 2, 2, 2, 2])], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR, critic: true })).status).toBe('ready');
    expect(steps(model)).toEqual(['writer', 'critic', 'fix', 'critic']);
    expect(model.calls[2].prompt).toContain('Acrescente o fato: Entregamos no mesmo dia em Marília.');
    const g = await generation(id);
    expect(g.variations[0].body).toBe(FIXED.text);
    expect(g.critic).toMatchObject({ band: 'forte', fixed: true });
    expect((await admin.query("select step, channel from generation_runs where brief_id = $1 and step in ('critic', 'fix') order by created_at", [id])).rows).toEqual([{ step: 'critic', channel: 'instagram' }, { step: 'fix', channel: 'instagram' }, { step: 'critic', channel: 'instagram' }]);
  });

  it('o conserto que não melhora a nota, ou que o revisor por regra reprova, deixa a legenda original', async () => {
    const t = tenantDb(A);
    const same = await brief('como saber se o bolo está pronto', 'informativo');
    const weak = critic(IG_IDS, IG_QUOTES, [2, 2, 2, 0, 2]);
    const m1 = fakeModel({ text: [POST, weak, FIXED, weak], image: [] });
    await generatePost(t, same, { model: m1, store, fontDir: FONT_DIR, critic: true });
    expect(steps(m1)).toEqual(['writer', 'critic', 'fix', 'critic']);
    const g1 = await generation(same);
    expect(g1.variations[0].body).toBe(CAPTION);
    expect(g1.critic.fixed).toBeUndefined();

    const banned = await brief('como saber se o bolo está pronto', 'informativo');
    const m2 = fakeModel({ text: [POST, weak, { text: 'Oferta imperdível: salve este post.' }], image: [] });
    await generatePost(t, banned, { model: m2, store, fontDir: FONT_DIR, critic: true });
    expect(steps(m2)).toEqual(['writer', 'critic', 'fix']);
    expect((await generation(banned)).variations[0].body).toBe(CAPTION);
  });

  it('avaliação que não vem, vem quebrada ou falha não derruba o post: ele fica pronto, sem avaliação', async () => {
    const t = tenantDb(A);
    for (const answer of [{}, { criteria: [{ id: 'envio', score: 2 }] }, new Error('modelo fora do ar')]) {
      const id = await brief('como saber se o bolo está pronto', 'informativo');
      const model = fakeModel({ text: [POST, answer], image: [] });
      expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR, critic: true })).status).toBe('ready');
      expect(steps(model)).toEqual(['writer', 'critic']);
      const g = await generation(id);
      expect(g.critic).toBeUndefined();
      expect(g.variations[0].body).toBe(CAPTION);
    }
  });

  it('sem critic ligado o fluxo é o de antes: nenhuma chamada a mais e nenhuma avaliação', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    const model = fakeModel({ text: [POST], image: [] });
    await generatePost(t, id, { model, store, fontDir: FONT_DIR });
    expect(steps(model)).toEqual(['writer']);
    expect((await generation(id)).critic).toBeUndefined();
  });

  it('o LinkedIn tem a própria avaliação, depois do texto, com a rede registrada', async () => {
    const t = tenantDb(A);
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    const model = fakeModel({ text: [{ ...POST, core: CORE }, critic(IG_IDS, IG_QUOTES, STRONG), LI, critic(LI_IDS, LI_QUOTES, [2, 2, 2, 2, 1])], image: [] });
    expect((await generatePost(t, id, { model, store, fontDir: FONT_DIR, critic: true })).status).toBe('ready');
    expect(steps(model)).toEqual(['writer', 'critic', 'adapt', 'critic']);
    expect(model.calls[3].prompt).toContain('post de LinkedIn');
    expect((await generation(id, 'linkedin')).critic).toMatchObject({ channel: 'linkedin', band: 'forte' });
    expect((await generation(id, 'instagram')).critic).toMatchObject({ channel: 'instagram' });
    const runs = (await admin.query("select step, channel from generation_runs where brief_id = $1 and step in ('writer', 'critic', 'adapt') order by created_at", [id])).rows;
    expect(runs).toEqual([{ step: 'writer', channel: 'instagram' }, { step: 'critic', channel: 'instagram' }, { step: 'adapt', channel: 'linkedin' }, { step: 'critic', channel: 'linkedin' }]);
  });
});

describe('tentar de novo só a rede que falhou (SPEC 028, BEZ-437)', () => {
  const CORE = { angle: 'Três sinais de bolo pronto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro'], proof: 'Três sinais de bolo pronto', question: 'Qual sinal você confere primeiro?' };
  const LI = { text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma e o palito sai limpo.\n\nQual sinal você confere primeiro na sua cozinha?', hashtags: ['confeitaria'], share_reason: 'Quem também faz bolo de festa responde com o sinal que confere primeiro' };
  const stepsOf = (m) => m.calls.map((c) => c.labels.step);
  const t = () => tenantDb(A);
  const deps = (model) => ({ model, store, fontDir: FONT_DIR });

  // Pedido nas duas redes em que o LinkedIn falhou: o Instagram está pronto e o motivo ficou no pedido.
  async function failedLinkedIn() {
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    const model = fakeModel({ text: [{ ...INFO, core: CORE }, new Error('modelo fora do ar')], image: [] });
    expect((await generatePost(t(), id, deps(model))).status).toBe('ready');
    return id;
  }

  it('a falha do LinkedIn fica no pedido e a tela mostra só essa rede com "Tentar de novo"', async () => {
    const id = await failedLinkedIn();
    expect((await one('select network_errors from briefs where id = $1', [id])).network_errors).toEqual({ linkedin: 'modelo fora do ar' });
    const progress = await requests.postProgress(t(), id);
    expect(progress.networks.map((n) => [n.id, n.state, n.canRetry])).toEqual([['core', 'done', false], ['instagram', 'done', false], ['linkedin', 'fail', true], ['review', 'done', false]]);
    expect(progress.networks[2].error).toBe('modelo fora do ar');
  });

  it('refazer só o LinkedIn não chama o redator do Instagram, reaproveita a arte e não gasta do limite', async () => {
    const id = await failedLinkedIn();
    const before = await monthlyUsage(t(), 2);
    const model = fakeModel({ text: [LI], image: [] });
    const { pendingId } = await retryNetwork(t(), id, 'linkedin', deps(model));

    expect(stepsOf(model)).toEqual(['adapt']);
    expect(model.calls[0].prompt).toContain('A massa desgruda da borda');
    const rows = (await admin.query('select pending_id, channel, post_design_id, visual_mode, images from pending_approvals where brief_id = $1 order by channel', [id])).rows;
    expect(rows.map((r) => r.channel)).toEqual(['instagram', 'linkedin']);
    expect(rows[1].pending_id).toBe(pendingId);
    expect(rows[1].post_design_id).toBe(rows[0].post_design_id);
    expect(rows[1].images[0].path).toBe(rows[0].images[0].path);
    expect((await one('select network_errors, status from briefs where id = $1', [id]))).toEqual({ network_errors: {}, status: 'ready' });
    expect((await monthlyUsage(t(), 2)).remaining).toBe(before.remaining);
    expect((await admin.query("select count(*)::int as n from generation_runs where brief_id = $1 and step = 'writer'", [id])).rows[0].n).toBe(1);
    const progress = await requests.postProgress(t(), id);
    expect(progress.networks.every((n) => n.state === 'done')).toBe(true);
  });

  it('tentar de novo outra vez devolve a mesma pendência sem chamar o modelo', async () => {
    const id = await failedLinkedIn();
    const first = await retryNetwork(t(), id, 'linkedin', deps(fakeModel({ text: [LI], image: [] })));
    const model = fakeModel({ text: [], image: [] });
    expect(await retryNetwork(t(), id, 'linkedin', deps(model))).toEqual(first);
    expect(model.calls).toHaveLength(0);
  });

  it('se falhar de novo, o motivo é atualizado, a pessoa recebe o próximo passo e nada vira pendência', async () => {
    const id = await failedLinkedIn();
    const model = fakeModel({ text: [new Error('limite de uso do modelo')], image: [] });
    await expect(retryNetwork(t(), id, 'linkedin', deps(model))).rejects.toThrow(/Não deu para escrever o post do LinkedIn agora/);
    expect((await one('select network_errors from briefs where id = $1', [id])).network_errors).toEqual({ linkedin: 'limite de uso do modelo' });
    expect((await admin.query("select 1 from pending_approvals where brief_id = $1 and channel = 'linkedin'", [id])).rowCount).toBe(0);
  });

  it('recusa rede que o pedido não pediu, rede que ainda não gera e pedido que não terminou', async () => {
    const only = await brief('dica rápida de bolo', 'informativo');
    await expect(retryNetwork(t(), only, 'linkedin', deps(fakeModel({ text: [], image: [] })))).rejects.toThrow(/não foi pedida/);
    const id = await failedLinkedIn();
    await expect(retryNetwork(t(), id, 'twitter', deps(fakeModel({ text: [], image: [] })))).rejects.toThrow(/ainda não gera/);
    await admin.query("delete from pending_approvals where brief_id = $1 and channel = 'linkedin'", [id]);
    await admin.query("update briefs set status = 'generating' where id = $1", [id]);
    await expect(retryNetwork(t(), id, 'linkedin', deps(fakeModel({ text: [], image: [] })))).rejects.toThrow(/ainda está sendo criado/);
  });
});

describe('reavaliar o texto e aplicar uma sugestão (SPEC 028, BEZ-441)', () => {
  const CORE = { angle: 'Três sinais de bolo pronto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro'], proof: 'Três sinais de bolo pronto', question: 'Qual sinal você confere primeiro?' };
  const LI = { text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma e o palito sai limpo.\n\nQual sinal você confere primeiro na sua cozinha?', hashtags: ['confeitaria'], share_reason: 'Quem também faz bolo de festa responde com o sinal que confere primeiro' };
  const LI_IDS = ['gancho', 'especificidade', 'leitura', 'pergunta', 'voz'];
  const LI_QUOTES = ['O erro mais caro de uma confeitaria', 'Eu só abro a porta', 'o palito sai limpo', 'Qual sinal você confere primeiro', 'Eu só abro a porta quando a borda descola'];
  const critic = (ids, quotes, scores) => ({ criteria: ids.map((id, i) => ({ id, score: scores[i], evidence: scores[i] ? quotes[i] : 'falta algo', suggestion: scores[i] === 2 ? null : 'Acrescente o fato: Entregamos no mesmo dia em Marília.' })) });
  const t = () => tenantDb(A);
  const deps = (model) => ({ model });
  const stepsOf = (m) => m.calls.map((c) => c.labels.step);

  // Pedido nas duas redes, pronto, sem avaliação guardada (a geração rodou sem o avaliador).
  async function ready() {
    const id = await brief('como saber se o bolo está pronto', 'informativo');
    await admin.query("update briefs set channels = '{instagram,linkedin}' where id = $1", [id]);
    expect((await generatePost(t(), id, { model: fakeModel({ text: [{ ...INFO, core: CORE }, LI], image: [] }), store, fontDir: FONT_DIR })).status).toBe('ready');
    const rows = (await admin.query('select pending_id, channel, generation from pending_approvals where brief_id = $1', [id])).rows;
    const by = (c) => rows.find((r) => r.channel === c);
    return { id, li: by('linkedin'), ig: by('instagram') };
  }
  const liText = (p) => p.generation.variations[0].body;

  it('avaliar de novo o texto guardado chama só o avaliador, guarda a avaliação e não gasta do limite', async () => {
    const { id, li } = await ready();
    const before = await monthlyUsage(t(), 2);
    const model = fakeModel({ text: [critic(LI_IDS, LI_QUOTES, [2, 2, 2, 1, 2])], image: [] });
    const out = await reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: liText(li), action: { evaluate: true } });
    expect(stepsOf(model)).toEqual(['critic']);
    expect(out).toMatchObject({ stored: true, text: null, critic: { channel: 'linkedin', band: 'forte' } });
    expect((await one('select generation from pending_approvals where pending_id = $1', [li.pending_id])).generation.critic).toMatchObject({ channel: 'linkedin' });
    expect((await monthlyUsage(t(), 2)).remaining).toBe(before.remaining);
    expect((await admin.query("select count(*)::int as n from generation_runs where brief_id = $1 and step in ('writer', 'adapt')", [id])).rows[0].n).toBe(2);
  });

  it('avaliar um texto editado vale para a tela e não mexe no que está guardado', async () => {
    const { li } = await ready();
    const edited = `${LI.text}\nE você, de que lado do forno está?`;
    const model = fakeModel({ text: [critic(LI_IDS, LI_QUOTES, [2, 2, 1, 2, 2])], image: [] });
    const out = await reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: edited, action: { evaluate: true } });
    expect(out.stored).toBe(false);
    expect(model.calls[0].prompt).toContain('E você, de que lado do forno está?');
    expect((await one('select generation from pending_approvals where pending_id = $1', [li.pending_id])).generation.critic).toBeUndefined();
  });

  it('a linha de hashtags no fim não vira parte do texto avaliado: o texto guardado continua o mesmo', async () => {
    const { li } = await ready();
    const model = fakeModel({ text: [critic(LI_IDS, LI_QUOTES, [2, 2, 2, 2, 2])], image: [] });
    const out = await reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: `${LI.text}\n\n#confeitaria #bolo`, action: { evaluate: true } });
    expect(out.stored).toBe(true);
  });

  it('aplicar uma sugestão reescreve só aquele ponto: uma chamada de conserto, outra de avaliação, sem redator e sem gastar do limite', async () => {
    const { li } = await ready();
    const before = await monthlyUsage(t(), 2);
    const fixed = LI.text.replace('Eu só abro a porta', 'Eu só abro a porta do forno');
    const model = fakeModel({ text: [{ text: fixed }, critic(LI_IDS, [...LI_QUOTES.slice(0, 1), 'Eu só abro a porta do forno', ...LI_QUOTES.slice(2)], [2, 2, 2, 2, 2])], image: [] });
    const out = await reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: LI.text, action: { apply: { criterionId: 'especificidade', suggestion: 'Acrescente o fato: Entregamos no mesmo dia em Marília.' } } });
    expect(stepsOf(model)).toEqual(['fix', 'critic']);
    expect(model.calls[0].prompt).toContain('Entregamos no mesmo dia em Marília');
    expect(model.calls[0].prompt).toContain(LI.text);
    expect(out).toMatchObject({ text: fixed, stored: false, critic: { band: 'forte' } });
    expect((await one('select generation from pending_approvals where pending_id = $1', [li.pending_id])).generation.variations[0].body).toBe(liText(li));
    expect((await monthlyUsage(t(), 2)).remaining).toBe(before.remaining);
  });

  it('o conserto que usa palavra proibida não vale: o texto fica como estava e a avaliação nem roda', async () => {
    const { li } = await ready();
    const model = fakeModel({ text: [{ text: LI.text.replace('erro mais caro', 'erro imperdível') }], image: [] });
    await expect(reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: LI.text, action: { apply: { criterionId: 'gancho', suggestion: 'Abra com um número.' } } })).rejects.toThrow(/não rendeu um texto melhor/);
    expect(stepsOf(model)).toEqual(['fix']);
  });

  it('um problema que o texto já tinha não bloqueia a sugestão, só o que o conserto introduz', async () => {
    const { li } = await ready();
    const withProblem = LI.text.replace('cedo demais', 'cedo demais, imperdível'); // palavra proibida que a pessoa digitou
    const fixed = withProblem.replace('Eu só abro a porta', 'Eu só abro a porta do forno');
    const model = fakeModel({ text: [{ text: fixed }, critic(LI_IDS, LI_QUOTES, [2, 2, 2, 2, 2])], image: [] });
    const out = await reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: withProblem, action: { apply: { criterionId: 'especificidade', suggestion: 'Acrescente um detalhe.' } } });
    expect(out.text).toBe(fixed);
    expect(stepsOf(model)).toEqual(['fix', 'critic']);
  });

  it('critério de outra rede, post de rede sem avaliação e pedido que não existe são recusados sem chamar o modelo', async () => {
    const { li } = await ready();
    const model = fakeModel({ text: [], image: [] });
    await expect(reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: LI.text, action: { apply: { criterionId: 'envio', suggestion: 'Mande para alguém.' } } })).rejects.toThrow(/não é de um critério desta rede/);
    await expect(reviewSignal(t(), deps(model), { pendingId: 'plat-nao-existe', text: LI.text, action: { evaluate: true } })).rejects.toThrow(/não encontrada/);
    await admin.query("update pending_approvals set channel = 'twitter' where pending_id = $1", [li.pending_id]);
    await expect(reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: LI.text, action: { evaluate: true } })).rejects.toThrow(/ainda não tem avaliação/);
    expect(model.calls).toHaveLength(0);
  });

  it('se o avaliador falhar, a pessoa recebe o próximo passo e nada do post muda', async () => {
    const { li } = await ready();
    const model = fakeModel({ text: [new Error('modelo fora do ar')], image: [] });
    await expect(reviewSignal(t(), deps(model), { pendingId: li.pending_id, text: liText(li), action: { evaluate: true } })).rejects.toThrow(/pode aprovar sem a avaliação/);
    expect((await one('select generation from pending_approvals where pending_id = $1', [li.pending_id])).generation.critic).toBeUndefined();
  });

  it('no Instagram, o avaliador lê também o texto que já está desenhado na imagem', async () => {
    const { ig } = await ready();
    const model = fakeModel({ text: [critic(['envio', 'salvamento', 'gancho', 'fato', 'chamada'], ['Salve este post', 'três sinais para conferir', 'Seu bolo está pronto', 'o bolo', 'Chame no WhatsApp'], [2, 2, 2, 1, 2])], image: [] });
    const out = await reviewSignal(t(), deps(model), { pendingId: ig.pending_id, text: ig.generation.variations[0].body, action: { evaluate: true } });
    expect(out.critic.channel).toBe('instagram');
    expect(model.calls[0].prompt).toContain('Seu bolo está pronto?');
  });
});
