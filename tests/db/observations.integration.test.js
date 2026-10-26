// As observações do público contra o Postgres (SPEC 022, BEZ-206): a escolha de quem gere a marca fica
// guardada por conta, só as observações ligadas viram dica, e a dica chega ao prompt do planejador de ideias
// (e não chega quando nada está ligado). Isolamento entre contas.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.PUBLISH_TZ_OFFSET = '-3';

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const obs = await import('../../platform/src/lib/observations.ts');
const coord = await import('../../platform/src/lib/content-coordinator.ts');

const A = 'it-obs-a';
const B = 'it-obs-b';
const ANA = '00000000-0000-4000-8000-000000000b01';
const ta = tenantDb(A);
const tb = tenantDb(B);
const DAY = 86_400_000;
const CONTENT = 'Posts informativos renderam 1,8 vez o engajamento dos de atmosfera.';
const AUDIENCE = 'Seu público tem 67% entre 25 e 44 anos e 71% de mulheres.';

// 9 informativos a 5,9% e 6 de atmosfera a 3,2% (o mesmo cenário da tela), dentro dos últimos 60 dias.
async function seedPosts(tenant) {
  for (let i = 0; i < 15; i += 1) {
    const info = i < 9;
    // horas diferentes: a recomendação de horário exige posts em pelo menos 3 horários
    const at = new Date(Date.now() - (2 + i * 3) * DAY - (i % 4) * 2 * 3_600_000).toISOString();
    const { rows: [brief] } = await admin.query("insert into briefs (tenant_id, idea, goal) values ($1, $2, $3) returning id", [tenant, `post ${i}`, info ? 'ensinar' : 'produto']);
    const { rows: [sched] } = await admin.query("insert into scheduled_posts (tenant_id, channel, variation, caption_final, brief_id, media_kind, status, scheduled_for) values ($1,'instagram','{}',$2,$3,'image','published',$4) returning id", [tenant, `post ${i}`, brief.id, at]);
    const { rows: [post] } = await admin.query("insert into posts (tenant_id, pillar, channel, hook, channels, is_dry_run, published_at, scheduled_post_id) values ($1,'post','instagram',$2,'{}',false,$3,$4) returning id", [tenant, `post ${i}`, at, sched.id]);
    await admin.query("insert into post_designs (tenant_id, brief_id, kind, layout, design) values ($1,$2,$3,'lista-numerada','{}')", [tenant, brief.id, info ? 'informativo' : 'atmosfera']);
    const eng = info ? 0.059 : 0.032;
    await admin.query("insert into metrics_snapshots (tenant_id, post_id, channel, likes, comments, reach, total_interactions, engagement_score, captured_at) values ($1,$2,'instagram',1,1,1000,$3,$4,now())", [tenant, post.id, Math.round(1000 * eng), eng]);
  }
  await admin.query(
    `insert into audience_snapshots (tenant_id, channel, captured_on, followers, age, gender, status) values ($1,'instagram',current_date,2310,$2,$3,'ok')`,
    [tenant, JSON.stringify({ '13-17': 0.02, '18-24': 0.14, '25-34': 0.38, '35-44': 0.29, '45-54': 0.11, '55-64': 0.04, '65+': 0.02 }), JSON.stringify({ F: 0.71, M: 0.27, U: 0.02 })],
  );
  await admin.query("insert into social_accounts (tenant_id, channel, external_id, handle, status, scopes, expires_at, connected_at) values ($1,'instagram',$2,'doce','active','{instagram_business_basic,instagram_business_manage_insights}', now() + interval '40 days', now())", [tenant, `1784140000000${tenant.length}${Math.floor(Math.random() * 1000)}`]);
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-ana-obs@example.test', 'Ana') on conflict do nothing", [ANA]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await admin.query("insert into company_profiles (tenant_id, niche, offering, audience) values ($1, 'Confeitaria', 'Bolos de pote', 'Famílias')", [A]);
  for (const wd of [2, 4, 6]) await admin.query("insert into publish_slots (tenant_id, channel, weekday, hour, minute) values ($1, 'instagram', $2, 18, 0)", [A, wd]);
  await admin.query("insert into publishing_controls (tenant_id, paused) values ($1, false) on conflict (tenant_id) do update set paused = false", [A]);
  await seedPosts(A);
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('escolha das observações', () => {
  it('sem escolha, nada está ligado e nenhuma dica sai', async () => {
    expect(await obs.enabledObservations(ta)).toEqual([]);
    expect(await obs.loadPlannerHints(ta)).toEqual([]);
  });

  it('a tela lê as observações de agora, quais estão ligadas e a data da leitura', async () => {
    const view = await obs.loadObservations(ta);
    expect(view.observations.map((o) => o.id)).toEqual(expect.arrayContaining(['content', 'audience', 'hours']));
    expect(view.observations.find((o) => o.id === 'content').text).toBe(CONTENT);
    expect(view.observations.find((o) => o.id === 'audience').text).toBe(AUDIENCE);
    expect(view.enabled).toEqual([]);
    expect(view.lastReadOn).toBe(new Date().toISOString().slice(0, 10));
  });

  it('ligar guarda quem decidiu, desligar e ligar de novo mantém uma linha só', async () => {
    await obs.setObservation(ta, ANA, 'content', true);
    expect(await obs.enabledObservations(ta)).toEqual(['content']);
    const row = (await admin.query("select enabled, decided_by from observation_settings where tenant_id = $1 and key = 'content'", [A])).rows[0];
    expect(row).toEqual({ enabled: true, decided_by: ANA });
    await obs.setObservation(ta, ANA, 'content', false);
    await obs.setObservation(ta, null, 'content', true);
    expect((await admin.query('select count(*)::int as n from observation_settings where tenant_id = $1', [A])).rows[0].n).toBe(1);
    expect(await obs.enabledObservations(ta)).toEqual(['content']);
  });

  it('só as observações ligadas viram dica; horário e formato nunca', async () => {
    expect(await obs.loadPlannerHints(ta)).toEqual([CONTENT]);
    await obs.setObservation(ta, ANA, 'audience', true);
    expect(await obs.loadPlannerHints(ta)).toEqual([CONTENT, AUDIENCE]);
    await obs.setObservation(ta, ANA, 'content', false);
    expect(await obs.loadPlannerHints(ta)).toEqual([AUDIENCE]);
  });

  it('a outra conta não vê a escolha nem os números', async () => {
    expect(await obs.enabledObservations(tb)).toEqual([]);
    await obs.setObservation(tb, ANA, 'content', true);
    expect(await obs.loadPlannerHints(tb)).toEqual([]); // ligada, mas sem posts nem público: nada a dizer
    expect(await obs.enabledObservations(ta)).toEqual(['audience']);
  });
});

describe('planejador de ideias', () => {
  const now = new Date('2026-10-21T15:00:00Z');
  const ideas = () => ({ calls: [], async generateJson(input) { this.calls.push(input); return { json: { ideas: [{ i: 0, idea: 'Uma ideia' }, { i: 1, idea: 'Outra ideia' }, { i: 2, idea: 'Mais uma' }] }, costUsd: 0 }; } });

  it('com a observação ligada, o prompt leva a dica; sem nada ligado, não leva', async () => {
    await obs.setObservation(ta, ANA, 'content', true);
    await obs.setObservation(ta, ANA, 'audience', true);
    const on = ideas();
    await coord.planForTenant(ta, { now, models: on });
    expect(on.calls).toHaveLength(1);
    expect(on.calls[0].prompt).toContain('O que os números desta conta mostram');
    expect(on.calls[0].prompt).toContain(`- ${CONTENT}`);
    expect(on.calls[0].prompt).toContain(`- ${AUDIENCE}`);

    await admin.query("delete from content_suggestions where tenant_id = $1", [A]);
    await obs.setObservation(ta, ANA, 'content', false);
    await obs.setObservation(ta, ANA, 'audience', false);
    const off = ideas();
    await coord.planForTenant(ta, { now, models: off });
    expect(off.calls).toHaveLength(1);
    expect(off.calls[0].prompt).not.toContain('O que os números desta conta mostram');
  });
});
