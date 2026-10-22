// Coordenador de conteúdo contra o Postgres (SPEC 017 decisão 8, BEZ-239): planejar os horários
// livres com histórico, foto do banco e ideias do modelo; rodar de novo sem duplicar; Trocar, Pular e
// Criar este post; isolamento entre contas; o job de todas as contas pulando a conta pausada.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.PUBLISH_TZ_OFFSET = '-3';

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const coord = await import('../../platform/src/lib/content-coordinator.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-coord-a';
const B = 'it-coord-b';
const C = 'it-coord-c';
const D = 'it-coord-d';
const ANA = { id: '00000000-0000-4000-8000-000000000601', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const ta = tenantDb(A);
const tb = tenantDb(B);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const rows = async (sql, params) => (await admin.query(sql, params)).rows;

// Quarta, 21/10/2026, 12:00 em Brasília. Horários de ter, qui e sáb às 18h: nos próximos 7 dias,
// qui 22, sáb 24 e ter 27. Qui 22 já tem um post agendado (objetivo ensinar).
const now = new Date('2026-10-21T15:00:00Z');
const THU = '2026-10-22T21:00:00.000Z';
const SAT = '2026-10-24T21:00:00.000Z';
const TUE = '2026-10-27T21:00:00.000Z';
const ideas = (list) => ({ calls: [], async generateJson(input) { this.calls.push(input); if (list instanceof Error) throw list; return { json: { ideas: list }, costUsd: 0 }; } });
let photoId;

async function cleanup() {
  await resetTenantData(admin, [A, B, C, D]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into users (id, email, name) values ($1, $2, $3) on conflict do nothing', [ANA.id, 'it-ana-coord@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [A, 'It Coord A', B, 'It Coord B', C, 'It Coord C']);
  await admin.query("insert into company_profiles (tenant_id, niche, offering, audience) values ($1, 'Confeitaria', 'Bolos de pote', 'Famílias')", [A]);
  for (const t of [A, C]) {
    for (const wd of [2, 4, 6]) await admin.query("insert into publish_slots (tenant_id, channel, weekday, hour, minute) values ($1, 'instagram', $2, 18, 0)", [t, wd]);
  }
  const brief = await one("insert into briefs (tenant_id, pillar, idea, status, goal) values ($1, 'ensinar', 'dica', 'ready', 'ensinar') returning id", [A]);
  await admin.query("insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, brief_id, status) values ($1, 'instagram', '{}', 'x', $2, $3, 'scheduled')", [A, THU, brief.id]);
  photoId = (await one(
    "insert into media_assets (tenant_id, storage_path, content_type, byte_size, width, height, description, tags) values ($1, 'tenants/' || $1 || '/media/f.jpg', 'image/jpeg', 10, 1080, 1350, 'Forno a lenha aceso', '{bastidor}') returning id",
    [A],
  )).id;
  // Conta nova nasce pausada (gatilho da 0013): A publica, C continua pausada.
  await admin.query("insert into publishing_controls (tenant_id, paused) values ($1, false) on conflict (tenant_id) do update set paused = false", [A]);
  await admin.query("insert into publishing_controls (tenant_id, paused) values ($1, true) on conflict (tenant_id) do update set paused = true", [C]);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('coordenador de conteúdo', () => {
  it('sugere um post por horário livre, com a foto do banco e as ideias do modelo', async () => {
    const models = ideas([{ i: 0, idea: 'O forno a lenha às 5h da manhã' }, { i: 1, idea: 'Pergunte qual sabor volta no cardápio' }]);
    const saved = await coord.planForTenant(ta, { now, models });
    expect(saved.map((s) => s.slotAt)).toEqual([SAT, TUE]);
    expect(saved[0]).toMatchObject({ goal: 'bastidores', assetId: photoId, idea: 'O forno a lenha às 5h da manhã', status: 'suggested' });
    expect(saved[0].reason).toMatch(/^Bastidores com a foto "Forno a lenha aceso"/);
    expect(saved[1].goal).not.toBe('bastidores');
    expect(saved[1].assetId).toBeNull();
    expect(models.calls[0].prompt).toContain('Ramo: Confeitaria.');
    expect(models.calls[0].labels).toMatchObject({ tenant: A, step: 'content_plan' });
  });

  it('rodar de novo não duplica, e a lista mostra as abertas em ordem', async () => {
    expect(await coord.planForTenant(ta, { now, models: ideas([]) })).toEqual([]);
    expect((await coord.listSuggestions(ta, now)).map((s) => s.slotAt)).toEqual([SAT, TUE]);
  });

  it('conta sem horário de Instagram não recebe sugestão', async () => {
    expect(await coord.planForTenant(tb, { now, models: null })).toEqual([]);
  });

  it('Trocar: entra outra para o mesmo horário, sem o objetivo trocado; modelo que falha usa o objetivo', async () => {
    const [, tue] = await coord.listSuggestions(ta, now);
    const next = await coord.replaceSuggestion(ta, ANA, tue.id, { now, models: ideas(new Error('Vertex 503')) });
    expect(next).toMatchObject({ slotAt: TUE, status: 'suggested' });
    expect(next.goal).not.toBe(tue.goal);
    expect(next.idea).toMatch(/, como "/);
    expect((await one('select status, decided_by from content_suggestions where id = $1', [tue.id]))).toEqual({ status: 'replaced', decided_by: ANA.id });
  });

  it('outra conta não decide a sugestão; decidir duas vezes recusa', async () => {
    const [sat] = await coord.listSuggestions(ta, now);
    await expect(coord.skipSuggestion(tb, ANA, sat.id)).rejects.toBeInstanceOf(UserError);
    const photo = await coord.createFromSuggestion(ta, ANA, sat.id, { wake: () => {} });
    expect(photo).toEqual({ kind: 'photo', assetId: photoId, idea: 'O forno a lenha às 5h da manhã' });
    await expect(coord.skipSuggestion(ta, ANA, sat.id)).rejects.toThrow(/já foi usada/);
  });

  it('Criar este post sem foto vira pedido com o objetivo e o formato padrão', async () => {
    const [tue] = await coord.listSuggestions(ta, now);
    let woke = 0;
    const out = await coord.createFromSuggestion(ta, ANA, tue.id, { wake: () => (woke += 1) });
    expect(out.kind).toBe('generate');
    expect(woke).toBe(1);
    const brief = await one('select idea, goal, ratio, status, requested_by from briefs where id = $1', [out.briefId]);
    expect(brief).toMatchObject({ idea: tue.idea, goal: tue.goal, ratio: '4:5', status: 'queued', requested_by: ANA.id });
    expect(await one('select status, brief_id from content_suggestions where id = $1', [tue.id])).toEqual({ status: 'created', brief_id: out.briefId });
  });

  it('Pular deixa o horário sem sugestão na próxima rodada', async () => {
    await admin.query("delete from content_suggestions where tenant_id = $1", [A]);
    const [sat] = await coord.planForTenant(ta, { now, models: null });
    await coord.skipSuggestion(ta, ANA, sat.id);
    const again = await coord.planForTenant(ta, { now, models: null });
    expect(again.map((s) => s.slotAt)).toEqual([]);
  });

  it('o job passa pelas contas com horário e pula a pausada', async () => {
    const summary = await coord.runContentPlanning({ now, models: null });
    expect(summary).toEqual({ accounts: 1, suggested: 0, paused: 1, failed: 0 });
    expect(await rows('select id from content_suggestions where tenant_id = $1', [C])).toEqual([]);
  });

  it('o banco recusa objetivo fora da lista e duas sugestões abertas no mesmo horário', async () => {
    await expect(admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason) values ($1, now(), 'auto', 'x', 'y')", [A])).rejects.toThrow(/check/);
    await admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason) values ($1, '2026-11-01T21:00:00Z', 'ensinar', 'x', 'y')", [A]);
    await expect(admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason) values ($1, '2026-11-01T21:00:00Z', 'produto', 'x', 'y')", [A])).rejects.toThrow(/content_suggestions_open_slot_idx/);
  });
});

// Com métricas reais (BEZ-246): posts publicados de bastidores engajam bem mais que os de novidade, só
// com curtidas e comentários (conta sem o escopo de insights). O coordenador puxa para bastidores.
describe('coordenador com métricas do Instagram', () => {
  const td = tenantDb(D);
  async function published(goal, daysAgo, likes, comments) {
    const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    const brief = await one("insert into briefs (tenant_id, pillar, idea, status, goal) values ($1, $2, 'x', 'ready', $2) returning id", [D, goal]);
    const sched = await one("insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, published_at, brief_id, status) values ($1, 'instagram', '{}', 'x', $2, $2, $3, 'published') returning id", [D, at, brief.id]);
    const post = await one("insert into posts (tenant_id, pillar, channel, scheduled_post_id, published_at, is_dry_run) values ($1, $2, 'instagram', $3, $4, false) returning id", [D, goal, sched.id, at]);
    await admin.query("insert into metrics_snapshots (tenant_id, post_id, channel, likes, comments, captured_at) values ($1, $2, 'instagram', $3, $4, $5)", [D, post.id, likes, comments, now.toISOString()]);
  }

  beforeAll(async () => {
    await admin.query("insert into tenants (id, name) values ($1, 'It Coord D') on conflict do nothing", [D]);
    await admin.query("insert into publishing_controls (tenant_id, paused) values ($1, false) on conflict (tenant_id) do update set paused = false", [D]);
    await admin.query("insert into publish_slots (tenant_id, channel, weekday, hour, minute) values ($1, 'instagram', 6, 18, 0)", [D]);
    await published('bastidores', 20, 80, 12);
    await published('bastidores', 14, 60, 9);
    await published('novidade', 10, 9, 1);
    await published('novidade', 4, 7, 0);
  });

  it('puxa para o objetivo que mais engaja e diz isso no motivo', async () => {
    const [sat] = await coord.planForTenant(td, { now, models: null });
    expect(sat).toMatchObject({ slotAt: SAT, goal: 'bastidores', reason: 'Bastidores é o que mais engaja na sua conta.' });
  });

  it('sem a regra de sequência quebrar: o último publicado sendo bastidores, não repete', async () => {
    await admin.query('delete from content_suggestions where tenant_id = $1', [D]);
    await published('bastidores', 3, 50, 5);
    const [sat] = await coord.planForTenant(td, { now, models: null });
    expect(sat.goal).not.toBe('bastidores');
  });
});
