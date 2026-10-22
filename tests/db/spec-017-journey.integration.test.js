// A jornada da conta nova até a primeira publicação contra o Postgres (SPEC 017, critério 1; BEZ-248).
// Junta as entregas que entraram em paralelo: perguntas e horários padrão (BEZ-234), guia, próximo passo
// do Início (BEZ-232), aprovar com horário (BEZ-230), coordenador (BEZ-239), agenda (BEZ-233),
// publicação e métricas (BEZ-183). Cada etapa confere o guia e o próximo passo pelo dado real.
// Meta e KMS são dublês; o resto é o código de verdade.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

// KMS dublê: o token "cifrado" é o próprio texto com o contexto na frente.
const box = {
  seal: async (plain, ctx) => ({ ciphertext: Buffer.from(`${ctx}|${plain}`).toString('base64'), keyVersion: 'v1' }),
  open: async ({ ciphertext }, ctx) => {
    const [c, ...rest] = Buffer.from(ciphertext, 'base64').toString().split('|');
    if (c !== ctx) throw new Error('contexto errado');
    return rest.join('|');
  },
};
vi.mock('../../platform/src/lib/secret-box.ts', async (orig) => ({ ...(await orig()), kmsBox: () => box }));

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const onboarding = await import('../../platform/src/lib/onboarding-data.ts');
const { homeSummary } = await import('../../platform/src/lib/home-summary.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const { createPostRequest } = await import('../../platform/src/lib/post-requests.ts');
const { approvePending } = await import('../../platform/src/lib/scheduling.ts');
const { runPublishDue } = await import('../../platform/src/lib/publish.ts');
const { setPause } = await import('../../platform/src/lib/pause.ts');
const { planForTenant, listSuggestions } = await import('../../platform/src/lib/content-coordinator.ts');
const { getAgenda } = await import('../../platform/src/lib/agenda.ts');
const { runMetricsCollection } = await import('../../platform/src/lib/instagram-metrics.ts');
const { socialTokenContext } = await import('../../platform/src/lib/secret-box.ts');
const { localDate } = await import('../../platform/src/lib/agenda-model.ts');
const { tzOffsetHours } = await import('../../platform/src/lib/slots.ts');

const T = 'it-journey';
const ANA = { id: '00000000-0000-4000-8000-0000000017a1', email: 'it-journey-ana@example.test', name: 'Ana' };
const ACCOUNT = '00000000-0000-4000-8000-0000000017b1';
const MEDIA = '17900000000000017';
const can = { approve: true, publishing: true, channels: true, create: true };
const guideCan = { create: true, approve: true, publishing: true, channels: true, brand: true, team: true };
const t = tenantDb(T);

// Meta dublê: cria o container, diz que está pronto, publica e devolve curtidas e comentários.
const graphCalls = [];
const meta = async (input, init) => {
  const u = new URL(input.toString());
  graphCalls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.pathname.endsWith('/media')) return json({ id: 'container-1' });
  if (u.pathname.endsWith('/container-1')) return json({ status_code: 'FINISHED' });
  if (u.pathname.endsWith('/media_publish')) return json({ id: MEDIA });
  if (u.pathname.endsWith(`/${MEDIA}`)) return json({ like_count: 12, comments_count: 3, id: MEDIA });
  throw new Error(`chamada inesperada à Meta: ${u.pathname}`);
};

const guide = async () => (await onboarding.loadGuide(t, 'admin', guideCan)).guide;
const step = (g, id) => g.steps.find((s) => s.id === id).status;
const next = async () => (await homeSummary(t, can)).next?.id ?? null;

beforeAll(async () => {
  await resetTenantData(admin, [T]);
  await admin.query('insert into users (id, email, name) values ($1, $2, $3) on conflict (id) do nothing', [ANA.id, ANA.email, ANA.name]);
  await admin.query("insert into tenants (id, name, kind) values ($1, 'It Journey', 'empresa')", [T]);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [T, ANA.id]);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await resetTenantData(admin, [T]);
  await admin.query('delete from users where id = $1', [ANA.id]);
  await admin.end();
});

describe('jornada da conta nova (SPEC 017, critério 1)', () => {
  let scheduledId;
  let slotAt;

  it('0. conta nova: guia no perfil, publicação pausada, próximo passo é conectar o Instagram', async () => {
    const g = await guide();
    expect(g.current).toBe('profile');
    expect(step(g, 'publishing')).toBe('todo');
    expect(await next()).toBe('instagram_connect');
  });

  it('1. as 3 perguntas criam os horários padrão, e o guia marca os horários', async () => {
    expect(await onboarding.saveOnboardingAnswers(t, ANA, { source: 'instagram', goal: 'vender_mais', postsPerWeek: 3 })).toEqual({ slotsCreated: 3 });
    expect(step(await guide(), 'slots')).toBe('done');
  });

  it('2. perfil completo pelo cadastro', async () => {
    await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'doceponto' } });
    const g = await guide();
    expect(step(g, 'profile')).toBe('done');
    expect(g.current).toBe('instagram');
  });

  it('3. Instagram conectado: o guia anda e o Início pede o primeiro post', async () => {
    await admin.query(
      `insert into social_accounts (id, tenant_id, channel, external_id, handle, status, scopes, expires_at, connected_at)
       values ($1, $2, 'instagram', '17841400000000017', 'doceponto', 'active', '{instagram_business_basic,instagram_business_content_publish}', now() + interval '50 days', now())`,
      [ACCOUNT, T],
    );
    const sealed = await box.seal('tok-journey', socialTokenContext(ACCOUNT));
    await admin.query('insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values ($1, $2, $3)', [ACCOUNT, sealed.ciphertext, sealed.keyVersion]);
    const g = await guide();
    expect(step(g, 'instagram')).toBe('done');
    expect(g.current).toBe('post');
    expect(await next()).toBe('empty_week');
  });

  it('4. pedido de post e o post pronto em Aprovar: o Início pede para revisar', async () => {
    const { id: briefId } = await createPostRequest(t, ANA, { idea: 'bolo de pote de ninho', kind: null, goal: 'produto', ratio: '4:5' });
    expect(step(await guide(), 'post')).toBe('done');
    // A geração em si tem teste próprio (generation-flow); aqui o post chega pronto em Aprovar.
    await admin.query(
      `insert into pending_approvals (tenant_id, pending_id, channel, brief_id, generation, images, post_kind)
       values ($1, 'plat-journey-1', 'instagram', $2, $3, $4, 'informativo')`,
      [T, briefId, JSON.stringify({ pillar: 'produto', goal: 'produto', ratio: '4:5', variations: [{ id: 1, hook: 'Bolo de pote', body: 'O de ninho voltou.', format: 'single' }] }), JSON.stringify([{ id: 1, url: 'https://app.test/api/media/images/journey.png' }])],
    );
    expect(await next()).toBe('pending');
  });

  it('5. aprovar agenda no próximo horário padrão; pausada, o Início pede para ligar a publicação', async () => {
    const res = await approvePending(t, { pendingId: 'plat-journey-1', captionId: 1, artId: 1 });
    expect(res.scheduledFor).not.toBeNull();
    scheduledId = res.id;
    slotAt = res.scheduledFor;
    const local = new Date(Date.parse(slotAt) + tzOffsetHours() * 3_600_000);
    expect([2, 4, 6]).toContain(local.getUTCDay());
    expect(local.getUTCHours()).toBe(18);
    // A junção que o coordenador usa para equilibrar os objetivos: o agendado leva o pedido.
    expect((await admin.query('select brief_id from scheduled_posts where id = $1', [scheduledId])).rows[0].brief_id).not.toBeNull();
    const g = await guide();
    expect(step(g, 'approve')).toBe('done');
    expect(g.current).toBe('publishing');
    expect(await next()).toBe('paused');
  });

  it('6. ligar a publicação fecha o passo; com o post da semana agendado, o Início não pede nada', async () => {
    await setPause(t, false);
    const g = await guide();
    expect(step(g, 'publishing')).toBe('done');
    expect(g.current).toBe('publish');
    const s = await homeSummary(t, can);
    expect(s.week.map((w) => w.id)).toEqual([scheduledId]);
    expect(s.next).toBeNull();
  });

  it('7. o coordenador sugere nos horários livres, nunca no ocupado, e a agenda mostra a sugestão na célula vazia', async () => {
    const saved = await planForTenant(t, { models: null });
    expect(saved.length).toBeGreaterThan(0);
    const open = await listSuggestions(t);
    expect(open.map((s) => s.slotAt)).not.toContain(slotAt);
    for (const s of open) expect(s.reason.length).toBeGreaterThan(0);

    const agenda = await getAgenda(t, { view: 'week', date: localDate(Date.parse(slotAt), tzOffsetHours()) });
    const cells = agenda.days.flatMap((d) => d.cells);
    const taken = cells.find((c) => c.at === slotAt);
    expect(taken?.post?.id).toBe(scheduledId);
    expect(taken?.suggestion).toBeNull();
    expect(agenda.slots).toBe(3);

    // Cada sugestão aberta aparece na célula vazia do horário dela, na semana dela.
    for (const sug of open) {
      const week = await getAgenda(t, { view: 'week', date: localDate(Date.parse(sug.slotAt), tzOffsetHours()) });
      const cell = week.days.flatMap((d) => d.cells).find((c) => c.at === sug.slotAt);
      expect(cell).toMatchObject({ kind: 'slot', post: null, suggestion: { id: sug.id, reason: sug.reason } });
    }
  });

  it('8. o cron publica na hora do horário: o guia some e o Início mostra o último publicado', async () => {
    vi.stubGlobal('fetch', meta);
    const summary = await runPublishDue(new Date(Date.parse(slotAt) + 60_000).toISOString());
    expect(summary).toMatchObject({ picked: 1, published: 1, failed: 0 });
    expect(graphCalls.map((c) => c.replace(/\/v[\d.]+/, ''))).toEqual(['POST /17841400000000017/media', 'GET /container-1', 'POST /17841400000000017/media_publish']);
    const g = await guide();
    expect(step(g, 'publish')).toBe('done');
    expect(g.hidden).toBe(true);
    const s = await homeSummary(t, can);
    expect(s.lastPublished).toMatchObject({ id: scheduledId, metrics: null });
    expect(s.lastPublished.postId).not.toBeNull();
  });

  it('9. a coleta de métricas lê o post publicado e o Início passa a mostrar curtidas e comentários', async () => {
    const r = await runMetricsCollection({ box, fetchFn: meta, nowMs: Date.parse(slotAt) + 2 * 3_600_000 });
    expect(r).toMatchObject({ collected: 1, failed: 0 });
    const s = await homeSummary(t, can);
    expect(s.lastPublished.metrics).toMatchObject({ likes: 12, comments: 3, reach: null, engagement: null });
  });

  it('10. agendado sem pilar (pendência antiga) publica e ainda grava o histórico para as métricas', async () => {
    const { rows } = await admin.query(
      `insert into scheduled_posts (tenant_id, channel, variation, caption_final, image_url, status, scheduled_for)
       values ($1, 'instagram', $2, 'legenda', 'https://app.test/api/media/images/old.png', 'scheduled', now()) returning id`,
      [T, JSON.stringify({ id: 1, hook: 'Antigo', body: 'Post antigo', format: 'single' })],
    );
    const { publishNow } = await import('../../platform/src/lib/publish.ts');
    expect(await publishNow(t, rows[0].id)).toEqual({ ok: true });
    const r = (await admin.query('select s.post_id, s.last_error, p.pillar from scheduled_posts s join posts p on p.id = s.post_id where s.id = $1', [rows[0].id])).rows[0];
    expect(r).toMatchObject({ last_error: null, pillar: 'post' });
  });
});
