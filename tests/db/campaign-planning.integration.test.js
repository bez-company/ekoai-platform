// O coordenador com campanha contra o Postgres (SPEC 018, BEZ-262): a campanha ocupa parte dos horários, o
// motivo sai de template, campanha que não vale não muda nada, fallback sem modelo, teto de custo por conta e
// por execução, a rodada diária uma vez só (inclusive ao mesmo tempo), Trocar mantém o grupo, Criar liga o pedido
// à campanha e o job encerra campanha vencida com o resumo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.PUBLISH_TZ_OFFSET = '-3';

const admin = new pg.Pool({ connectionString: url, max: 6 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const coord = await import('../../platform/src/lib/content-coordinator.ts');
const campaigns = await import('../../platform/src/lib/campaigns.ts');
const facts = await import('../../platform/src/lib/company-facts.ts');

const E = 'it-cpl-e'; // com campanha
const F = 'it-cpl-f'; // igual, sem campanha
const G = 'it-cpl-g'; // o job diário
const ANA = { id: '00000000-0000-4000-8000-000000000751', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const [te, tf, tg] = [tenantDb(E), tenantDb(F), tenantDb(G)];
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rows = async (sql, params) => (await admin.query(sql, params)).rows;

// Quarta, 21/10/2026, 12:00 em Brasília: os horários de ter, qui e sáb às 18h caem em qui 22, sáb 24 e ter 27.
const now = new Date('2026-10-21T15:00:00Z');
const DAY = '2026-10-21';
const THU = '2026-10-22T21:00:00.000Z';
const SAT = '2026-10-24T21:00:00.000Z';
const TUE = '2026-10-27T21:00:00.000Z';

const input = (over = {}) => ({
  name: 'Encomendas de fim de ano',
  kind: 'vender',
  objective: 'Vender as caixas de fim de ano até 15 de dezembro',
  offering: 'Caixas de panetone por R$ 89',
  audience: 'Famílias e empresas que dão presente',
  cta: 'whatsapp',
  restrictions: ['desconto'],
  target_label: null,
  target_value: null,
  posts_per_week: 3,
  start_date: '2026-10-12',
  end_date: '2026-12-15',
  ...over,
});

// Modelo falso: devolve as ideias programadas e conta as chamadas; se for chamado quando não devia, o teste falha.
const model = (list, costUsd = 0.0004) => ({ calls: [], async generateJson(i) { this.calls.push(i); return { json: { ideas: typeof list === 'function' ? list(i) : list }, costUsd }; } });
const forbidden = () => ({ calls: [], async generateJson() { throw new Error('o modelo não devia ser chamado'); } });
const shape = (saved) => saved.map((s) => [s.slotAt, s.goal, s.rule, s.reason]);
const planned = (id) => rows('select slot_at, goal, rule, reason, campaign_id, status, idea from content_suggestions where tenant_id = $1 order by slot_at', [id]);

async function clearSuggestions(tenant) {
  await admin.query('delete from content_suggestions where tenant_id = $1', [tenant]);
  await admin.query('delete from planning_runs where tenant_id = $1', [tenant]);
}

async function withCampaign(over, steps = ['confirm']) {
  await admin.query('delete from content_suggestions where tenant_id = $1', [E]);
  await admin.query('delete from campaigns where tenant_id = $1', [E]);
  const c = await campaigns.createCampaign(te, ANA, input(over));
  for (const action of steps) await campaigns.changeCampaign(te, ANA, c.id, action, now);
  return c;
}

beforeAll(async () => {
  await resetTenantData(admin, [E, F, G]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-cpl-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  for (const t of [E, F, G]) {
    await admin.query("insert into tenants (id, name) values ($1, $1)", [t]);
    await admin.query("insert into publishing_controls (tenant_id, paused) values ($1, false) on conflict (tenant_id) do update set paused = false", [t]);
    await admin.query("insert into company_profiles (tenant_id, niche, offering, audience, banned_words) values ($1, 'Confeitaria', 'Bolos e doces', 'Famílias', '{imperdível}')", [t]);
    for (const wd of [2, 4, 6]) await admin.query("insert into publish_slots (tenant_id, channel, weekday, hour, minute) values ($1, 'instagram', $2, 18, 0)", [t, wd]);
  }
  // fatos da conta E: um vale, um venceu, um espera confirmação
  await facts.createFact(te, ANA, { kind: 'fact', text: 'Entregamos no mesmo dia', source: 'owner', source_note: null, category: 'sobre_a_empresa', valid_until: null });
  await admin.query("insert into company_facts (tenant_id, kind, text, status, verified_at, valid_until, category) values ($1, 'fact', 'Bolo de pote por R$ 18', 'confirmed', now(), '2026-10-15', 'oferta_preco')", [E]);
  await facts.createAgentFact(te, { kind: 'fact', text: 'Mais de 2 mil bolos entregues', source: 'site', source_note: null, category: 'numero_resultado', valid_until: null });
});

afterAll(async () => {
  await resetTenantData(admin, [E, F, G]);
  await admin.end();
});

describe('a campanha ocupa parte dos horários', () => {
  it('3 horários livres: o primeiro e o último são da campanha, com o motivo de template e a ideia do modelo', async () => {
    await withCampaign({});
    const m = model([{ i: 0, idea: 'Caixa de panetone por R$ 89 para presentear' }, { i: 1, idea: 'Mostre o forno aceso logo cedo' }, { i: 2, idea: 'Cliente conta como foi a caixa' }]);
    const saved = await coord.planForTenant(te, { now, models: m });
    expect(saved.map((s) => [s.slotAt, s.rule, s.campaignId !== null])).toEqual([[THU, 'campaign', true], [SAT, 'rotation', false], [TUE, 'campaign', true]]);
    expect(saved[0].reason).toMatch(/^Campanha Encomendas de fim de ano: 1 de 2 posts da semana\. /);
    expect(saved[2].reason).toMatch(/^Campanha Encomendas de fim de ano: 2 de 2 posts da semana\. /);
    expect(saved[1].reason).not.toMatch(/Campanha/);
    for (const s of [saved[0], saved[2]]) expect(['produto', 'promocao', 'prova_social']).toContain(s.goal);
    expect(saved[0].idea).toBe('Caixa de panetone por R$ 89 para presentear'); // o número é da oferta da campanha
    const stored = await planned(E);
    expect(stored.map((r) => [r.rule, r.campaign_id !== null])).toEqual([['campaign', true], ['rotation', false], ['campaign', true]]);
  });

  it('o modelo recebe a campanha e só os fatos que valem: o vencido e o pendente ficam de fora', async () => {
    await withCampaign({});
    const m = model([]);
    await coord.planForTenant(te, { now, models: m });
    const prompt = m.calls[0].prompt;
    expect(prompt).toContain('Campanha ativa: Encomendas de fim de ano.');
    expect(prompt).toContain('- Entregamos no mesmo dia');
    expect(prompt).not.toContain('R$ 18');
    expect(prompt).not.toContain('2 mil bolos');
    expect(prompt).toContain('- desconto'); // restrição da campanha
    expect(prompt).toMatch(/; campanha: sim/);
    expect(m.calls[0].labels).toMatchObject({ tenant: E, step: 'content_plan' });
  });

  it('a ideia com número fora dos fatos (ou de fato vencido) volta para o fallback, só ela', async () => {
    await withCampaign({});
    const m = model([{ i: 0, idea: 'Caixa de panetone por R$ 89 para presentear' }, { i: 1, idea: 'Forno aceso às 5h da manhã' }, { i: 2, idea: 'Bolo de pote por R$ 18 só hoje' }]);
    const saved = await coord.planForTenant(te, { now, models: m });
    expect(saved[0].idea).toBe('Caixa de panetone por R$ 89 para presentear');
    expect(saved[1].idea).toMatch(/, como "/); // número sem fato: fallback do objetivo
    expect(saved[2].idea).toMatch(/^[^:]+: Caixas de panetone por R\$ 89$/); // vencido: fallback com a oferta da campanha
    expect((await one('select fallback from planning_runs where tenant_id = $1 and ran_on = $2', [E, DAY])).fallback).toBe(true);
  });
});

describe('campanha que não vale não muda nada', () => {
  it('rascunho, pausada, encerrada e fora do prazo dão o mesmo planejamento de uma conta sem campanha', async () => {
    const plain = await coord.planForTenant(tf, { now, models: null });
    expect(plain).toHaveLength(3);
    const variants = [
      ['rascunho', {}, []],
      ['pausada', {}, ['confirm', 'pause']],
      ['encerrada', {}, ['confirm', 'end']],
      ['ainda não começou', { start_date: '2026-11-01' }, ['confirm']],
    ];
    for (const [name, over, steps] of variants) {
      await withCampaign(over, steps);
      const saved = await coord.planForTenant(te, { now, models: null });
      expect(shape(saved), name).toEqual(shape(plain));
      expect(saved.every((s) => s.campaignId === null), name).toBe(true);
    }
  });

  it('o prazo que acaba hoje ainda vale; amanhã já não', async () => {
    await withCampaign({ end_date: DAY });
    const today = await coord.planForTenant(te, { now, models: null });
    expect(today.some((s) => s.rule === 'campaign')).toBe(true);
    await admin.query('delete from content_suggestions where tenant_id = $1', [E]);
    const tomorrow = await coord.planForTenant(te, { now: new Date('2026-10-22T15:00:00Z'), models: null });
    expect(tomorrow.every((s) => s.rule !== 'campaign')).toBe(true);
  });
});

describe('fallback e teto de custo', () => {
  it('modelo fora do ar: a sequência, o motivo e os horários são os mesmos com ou sem modelo', async () => {
    await withCampaign({});
    await clearSuggestions(E);
    const withModel = await coord.planForTenant(te, { now, models: model([]) });
    await clearSuggestions(E);
    const broken = await coord.planForTenant(te, { now, models: { async generateJson() { throw new Error('Vertex 503'); } } });
    await clearSuggestions(E);
    const without = await coord.planForTenant(te, { now, models: null });
    expect(shape(broken)).toEqual(shape(withModel));
    expect(shape(without)).toEqual(shape(withModel));
    expect(broken.map((s) => s.idea)).toEqual(without.map((s) => s.idea));
  });

  it('ambiente sem o modelo configurado: o planejamento não cai e as ideias saem do objetivo', async () => {
    await withCampaign({});
    await clearSuggestions(E);
    const saved = process.env.VERTEX_PROJECT_ID;
    delete process.env.VERTEX_PROJECT_ID;
    try {
      const out = await coord.planForTenant(te, { now });
      expect(out).toHaveLength(3);
      expect(out.every((s) => !!s.idea && !!s.reason)).toBe(true);
      expect((await one('select fallback, llm_calls from planning_runs where tenant_id = $1 and ran_on = $2', [E, DAY]))).toEqual({ fallback: true, llm_calls: 0 });
    } finally {
      if (saved !== undefined) process.env.VERTEX_PROJECT_ID = saved;
    }
  });

  it('teto por conta e dia: depois de 10 chamadas, o modelo nem é chamado e a ideia sai do objetivo', async () => {
    await withCampaign({});
    await clearSuggestions(E);
    await admin.query("insert into planning_runs (tenant_id, ran_on, llm_calls) values ($1, $2, $3)", [E, DAY, coord.MAX_LLM_CALLS_PER_DAY]);
    const m = forbidden();
    const saved = await coord.planForTenant(te, { now, models: m });
    expect(saved).toHaveLength(3);
    expect(m.calls).toHaveLength(0);
    const day = await one('select llm_calls, fallback, suggested from planning_runs where tenant_id = $1 and ran_on = $2', [E, DAY]);
    expect(day).toEqual({ llm_calls: 10, fallback: true, suggested: 3 });
  });

  it('cada rodada com modelo soma uma chamada e o custo no dia', async () => {
    await clearSuggestions(E);
    await coord.planForTenant(te, { now, models: model([], 0.0123) });
    await admin.query('delete from content_suggestions where tenant_id = $1', [E]);
    await coord.planForTenant(te, { now, models: model([], 0.0077) });
    const day = await one('select llm_calls, cost_usd::float as cost from planning_runs where tenant_id = $1 and ran_on = $2', [E, DAY]);
    expect(day.llm_calls).toBe(2);
    expect(day.cost).toBeCloseTo(0.02, 5);
  });
});

describe('a rodada diária do job', () => {
  // O job passa por todas as contas com horário: para contar só a conta G, as outras ficam sem horário até o fim.
  beforeAll(async () => {
    await admin.query('delete from publish_slots where tenant_id in ($1, $2)', [E, F]);
    await clearSuggestions(G);
  });
  afterAll(async () => {
    for (const t of [E, F]) for (const wd of [2, 4, 6]) await admin.query("insert into publish_slots (tenant_id, channel, weekday, hour, minute) values ($1, 'instagram', $2, 18, 0)", [t, wd]);
  });

  it('planeja a conta uma vez; rodar de novo no mesmo dia pula e não gasta', async () => {
    const m = model([]);
    const first = await coord.runContentPlanning({ now, models: m });
    expect(first).toMatchObject({ accounts: 1, suggested: 3, skipped: 0, failed: 0 });
    expect(m.calls).toHaveLength(1);
    const again = await coord.runContentPlanning({ now, models: m });
    expect(again).toMatchObject({ accounts: 0, suggested: 0, skipped: 1 });
    expect(m.calls).toHaveLength(1);
    expect((await rows('select llm_calls from planning_runs where tenant_id = $1', [G])).map((r) => r.llm_calls)).toEqual([1]);
  });

  it('dois jobs ao mesmo tempo: um planeja, o outro pula, uma linha e uma chamada', async () => {
    await clearSuggestions(G);
    const m = model([]);
    const [a, b] = await Promise.all([coord.runContentPlanning({ now, models: m }), coord.runContentPlanning({ now, models: m })]);
    expect(a.accounts + b.accounts).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(m.calls).toHaveLength(1);
    expect(await rows('select 1 from planning_runs where tenant_id = $1', [G])).toHaveLength(1);
    expect((await planned(G)).length).toBe(3);
  });

  it('o "Trocar" manual não gasta a rodada do dia: o job ainda roda depois dele', async () => {
    await clearSuggestions(G);
    await admin.query("insert into planning_runs (tenant_id, ran_on, llm_calls) values ($1, $2, 1)", [G, DAY]); // linha de um Trocar, sem round_at
    const m = model([]);
    expect(await coord.runContentPlanning({ now, models: m })).toMatchObject({ accounts: 1, suggested: 3, skipped: 0 });
  });

  it('uma rodada que falhou pode ser refeita no mesmo dia', async () => {
    await clearSuggestions(G);
    await admin.query("insert into planning_runs (tenant_id, ran_on, status, error_code, round_at) values ($1, $2, 'failed', 'Error', now())", [G, DAY]);
    expect(await coord.runContentPlanning({ now, models: model([]) })).toMatchObject({ accounts: 1, suggested: 3 });
    expect((await one('select status, error_code from planning_runs where tenant_id = $1 and ran_on = $2', [G, DAY]))).toEqual({ status: 'done', error_code: null });
  });

  it('teto de custo da execução: sem orçamento o modelo nem é chamado e a conta é contada como fallback', async () => {
    await clearSuggestions(G);
    const m = forbidden();
    const out = await coord.runContentPlanning({ now, models: m, budget: { remainingUsd: () => 0 } });
    expect(out).toMatchObject({ accounts: 1, suggested: 3, fallback: 1, costUsd: 0 });
    expect(m.calls).toHaveLength(0);
  });

  it('o custo da execução soma o que cada conta gastou', async () => {
    await clearSuggestions(G);
    const out = await coord.runContentPlanning({ now, models: model([], 0.05) });
    expect(out.costUsd).toBeCloseTo(0.05, 5);
  });
});

describe('Trocar e Criar com campanha', () => {
  it('a sugestão trocada segue no grupo dela; a de rotação segue de rotação', async () => {
    await withCampaign({});
    await clearSuggestions(E);
    const [camp, rot] = await coord.planForTenant(te, { now, models: null });
    expect(camp.rule).toBe('campaign');
    expect(rot.rule).toBe('rotation');
    const nextCamp = await coord.replaceSuggestion(te, ANA, camp.id, { now, models: null });
    expect(nextCamp).toMatchObject({ slotAt: THU, rule: 'campaign' });
    expect(nextCamp.campaignId).toBe(camp.campaignId);
    expect(nextCamp.goal).not.toBe(camp.goal);
    expect(nextCamp.reason).toMatch(/^Campanha Encomendas de fim de ano: 1 de 2 posts da semana\. /);
    const nextRot = await coord.replaceSuggestion(te, ANA, rot.id, { now, models: null });
    expect(nextRot).toMatchObject({ slotAt: SAT, rule: 'rotation', campaignId: null });
  });

  it('Criar este post liga o pedido à campanha; a sugestão de rotação não liga', async () => {
    const [first, second] = await coord.listSuggestions(te, now);
    const a = await coord.createFromSuggestion(te, ANA, first.id, { wake: () => {} });
    const b = await coord.createFromSuggestion(te, ANA, second.id, { wake: () => {} });
    expect(a.kind).toBe('generate');
    expect((await one('select campaign_id from briefs where id = $1', [a.briefId])).campaign_id).toBe(first.campaignId);
    expect((await one('select campaign_id from briefs where id = $1', [b.briefId])).campaign_id).toBeNull();
  });

  it('nenhuma sugestão vira publicação sozinha: depois de planejar, não há pedido nem agendado novo', async () => {
    await clearSuggestions(F);
    await admin.query('delete from briefs where tenant_id = $1', [F]);
    await coord.planForTenant(tf, { now, models: model([]) });
    expect((await rows('select 1 from briefs where tenant_id = $1', [F])).length).toBe(0);
    expect((await rows('select 1 from scheduled_posts where tenant_id = $1', [F])).length).toBe(0);
  });
});

describe('cota da semana com o que já existe', () => {
  it('posts de campanha que a semana já tem entram na conta: não passa de 60% dos horários', async () => {
    await withCampaign({});
    await clearSuggestions(E);
    const c = (await campaigns.listCampaigns(te))[0];
    // uma sugestão de campanha já aberta em sáb 24 (conta 1 dos 2 posts da cota de 3 horários)
    await admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason, campaign_id, rule) values ($1, $2, 'produto', 'x', 'y', $3, 'campaign')", [E, SAT, c.id]);
    const saved = await coord.planForTenant(te, { now, models: null });
    // sobra 1 da cota: vai para o primeiro horário livre, e o motivo numera na ordem do calendário (qui é o 1º, sáb o 2º)
    expect(saved.map((s) => [s.slotAt, s.rule])).toEqual([[THU, 'campaign'], [TUE, 'rotation']]);
    expect(saved[0].reason).toMatch(/^Campanha Encomendas de fim de ano: 1 de 2 posts da semana\. /);
  });
});

describe('encerrar campanha vencida', () => {
  it('o job encerra a ativa e a pausada que passaram do prazo, avisa o admin com o resumo e não repete', async () => {
    await admin.query('delete from campaigns where tenant_id = $1', [E]);
    const early = new Date('2026-10-01T15:00:00Z');
    const a = await campaigns.createCampaign(te, ANA, input({ name: 'Semana das Crianças', start_date: '2026-09-28', end_date: '2026-10-12' }));
    await campaigns.changeCampaign(te, ANA, a.id, 'confirm', early);
    const b = await campaigns.createCampaign(te, ANA, input({ name: 'Campanha pausada', start_date: '2026-09-28', end_date: '2026-10-10' }));
    await campaigns.changeCampaign(te, ANA, b.id, 'confirm', early).catch(() => undefined); // só uma ativa
    await admin.query("update campaigns set status = 'paused', confirmed_at = now() where id = $1", [b.id]);
    const live = await campaigns.createCampaign(te, ANA, input({ name: 'Ainda vale', start_date: '2026-10-12', end_date: '2026-12-15' }));
    await admin.query("update campaigns set status = 'paused', confirmed_at = now() where id = $1", [live.id]);

    const out = await campaigns.endExpiredCampaigns(now);
    expect(out).toEqual({ ended: 2, failed: 0 });
    const status = Object.fromEntries((await rows('select name, status from campaigns where tenant_id = $1', [E])).map((r) => [r.name, r.status]));
    expect(status).toEqual({ 'Semana das Crianças': 'ended', 'Campanha pausada': 'ended', 'Ainda vale': 'paused' });
    const notes = await rows("select title, body, audience, link from notifications where tenant_id = $1 and kind = 'campaign.ended' order by title", [E]);
    expect(notes.map((n) => n.title)).toEqual(['Campanha encerrada: Campanha pausada', 'Campanha encerrada: Semana das Crianças']);
    expect(notes.every((n) => n.audience === 'admin' && n.link === '/campaigns')).toBe(true);
    expect(notes[1].body).toBe('0 posts publicados. O coordenador voltou à rotação.');
    expect(JSON.stringify(notes)).not.toMatch(/venda|conversão|retorno/i);
    expect(await campaigns.endExpiredCampaigns(now)).toEqual({ ended: 0, failed: 0 });
  });

  it('o resumo diz posts e engajamento na mesma medida, e nunca venda', () => {
    const body = (p) => campaigns.endedNoticeBody(p);
    const base = { daysLeft: 0, daysTotal: 10, suggested: 0, created: 0, scheduled: 0, cadence: { thisWeek: 0, target: null } };
    expect(body({ ...base, published: 1, engagement: { unit: 'interactions', campaign: 20, account: 46.7, campaignPosts: 1, accountPosts: 3 } })).toBe('1 post publicado, com engajamento de 20 curtidas e comentários por post (média da conta: 47 curtidas e comentários por post). O coordenador voltou à rotação.');
    expect(body({ ...base, published: 5, engagement: { unit: 'rate', campaign: 0.058, account: 0.062, campaignPosts: 5, accountPosts: 20 } })).toBe('5 posts publicados, com engajamento de 5,8% (média da conta: 6,2%). O coordenador voltou à rotação.');
    expect(body({ ...base, published: 2, engagement: { unit: 'rate', campaign: null, account: null, campaignPosts: 0, accountPosts: 0 } })).toBe('2 posts publicados. O coordenador voltou à rotação.');
  });
});
