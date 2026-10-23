// Publicação confiável contra o Postgres (BEZ-258, migration 0036), com a Meta como dublê que falha de
// propósito: timeout antes e depois da confirmação, queda entre a resposta e o gravar no banco, conta
// pausada, concorrência, token vencido e imagem inválida. O critério é 0 post duplicado na Meta e todo
// post preso resolvido e registrado em publish_reconciliations. O dublê da Meta é fiel ao que a
// documentação diz (container PUBLISHED depois do media_publish; segunda publicação do mesmo container
// recusada); o comportamento real da Meta não foi exercitado aqui.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

// Credenciais do Instagram dublê: cada teste decide se há conexão, se venceu ou se está tudo certo.
let credsImpl = async () => ({ accountId: '1784', token: 'tok' });
vi.mock('../../platform/src/lib/social-accounts.ts', async (orig) => ({ ...(await orig()), instagramCredentials: (...a) => credsImpl(...a) }));

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const publish = await import('../../platform/src/lib/publish.ts');
const { setPause } = await import('../../platform/src/lib/pause.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const { runPublishDue, publishNow, reconcileStalePublishing, hasPendingPublishes, LEASE_TTL_MS } = publish;
const A = 'it-pubrel-a';
const B = 'it-pubrel-b';
const C = 'it-pubrel-c';
const ACCT = '1784';

// ── Meta dublê ────────────────────────────────────────────────────────────────────────────────
// Guarda containers e posts publicados. `plan` decide, por chamada ao media_publish, o que acontece.
let meta;
function newMeta() {
  return {
    containers: new Map(), // id -> { status, caption }
    media: [], // posts que existem de verdade no Instagram
    publishCalls: 0,
    createCalls: 0,
    down: false, // a rede inteira fora do ar
    plan: [], // por chamada ao media_publish: 'ok' | 'timeout_before' | 'timeout_after' | 'http500' | { gate?: Promise, run?: fn, then }
    createError: null, // { status, body } na criação do container
    seq: 0,
  };
}
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(input, init) {
  const u = new URL(input.toString());
  const path = u.pathname.replace(/^\/v[\d.]+/, '');
  if (meta.down) throw new TypeError('fetch failed');
  const method = init?.method ?? 'GET';
  if (method === 'POST' && path === `/${ACCT}/media`) {
    meta.createCalls += 1;
    if (meta.createError) return json({ error: { message: meta.createError.body } }, meta.createError.status);
    const body = new URLSearchParams(String(init.body));
    const id = `c${(meta.seq += 1)}`;
    meta.containers.set(id, { status: 'FINISHED', caption: body.get('caption') ?? '' });
    return json({ id });
  }
  if (method === 'POST' && path === `/${ACCT}/media_publish`) {
    meta.publishCalls += 1;
    const entry = meta.plan.shift() ?? 'ok';
    // { gate, then }: segura a chamada até o teste liberar e segue com o resultado de `then`
    const step = typeof entry === 'string' ? entry : (await entry.gate, entry.run?.(), entry.then ?? 'ok');
    const id = new URLSearchParams(String(init.body)).get('creation_id');
    const c = meta.containers.get(id);
    if (step === 'timeout_before') throw timeout();
    if (step === 'http500') return json({ error: { message: 'down' } }, 500);
    if (!c || c.status === 'PUBLISHED') return json({ error: { message: 'Media ID is not available' } }, 400);
    c.status = 'PUBLISHED';
    const mediaId = `m${meta.media.length + 1}`;
    meta.media.push({ id: mediaId, caption: c.caption, timestamp: new Date().toISOString().replace(/\.\d+Z$/, '+0000') });
    if (step === 'timeout_after') throw timeout(); // a Meta publicou, a resposta se perdeu
    return json({ id: mediaId });
  }
  if (method === 'GET' && path === `/${ACCT}/media`) return json({ data: [...meta.media].reverse() });
  const container = path.slice(1);
  if (method === 'GET' && meta.containers.has(container)) return json({ status_code: meta.containers.get(container).status });
  throw new Error(`chamada inesperada à Meta: ${method} ${path}`);
}

// ── Dados ──────────────────────────────────────────────────────────────────────────────────────
let n = 0;
async function post(tenant, { status = 'scheduled', scheduledFor = new Date(Date.now() - 60_000), caption, extra = {} } = {}) {
  n += 1;
  const cols = { attempt_id: null, publishing_started_at: null, meta_container_id: null, attempts: 0, ...extra };
  const { rows } = await admin.query(
    `insert into scheduled_posts (tenant_id, channel, variation, caption_final, image_url, status, scheduled_for, attempt_id, publishing_started_at, meta_container_id, attempts)
     values ($1, 'instagram', $2, $3, 'https://app.test/api/media/images/a.png', $4, $5, $6, $7, $8, $9) returning id`,
    [tenant, JSON.stringify({ id: 1, hook: `Gancho ${n}`, body: 'Corpo', format: 'single' }), caption ?? `legenda ${n}`, status, scheduledFor, cols.attempt_id, cols.publishing_started_at, cols.meta_container_id, cols.attempts],
  );
  return rows[0].id;
}
const row = async (id) => (await admin.query('select status, attempts, last_error, attempt_id, meta_container_id, post_id from scheduled_posts where id = $1', [id])).rows[0];
const posts = async (tenant) => (await admin.query('select id from posts where tenant_id = $1', [tenant])).rowCount;
const recs = async (id) => (await admin.query('select found, action, container_id, detail from publish_reconciliations where scheduled_post_id = $1 order by created_at, id', [id])).rows;
const notices = async (tenant) => (await admin.query('select kind, level from notifications where tenant_id = $1 order by id', [tenant])).rows;
const longAgo = () => new Date(Date.now() - LEASE_TTL_MS - 5 * 60_000);

// Um post que o processo largou em publishing, com a Meta no estado dado.
async function stuck(tenant, { container = null, metaStatus, caption = 'legenda presa' } = {}) {
  let containerId = null;
  if (container) {
    containerId = `c${(meta.seq += 1)}`;
    meta.containers.set(containerId, { status: metaStatus, caption });
    if (metaStatus === 'PUBLISHED') meta.media.push({ id: `m${meta.media.length + 1}`, caption, timestamp: new Date().toISOString().replace(/\.\d+Z$/, '+0000') });
  }
  return post(tenant, { status: 'publishing', caption, extra: { attempt_id: '00000000-0000-4000-8000-0000000000aa', publishing_started_at: longAgo(), meta_container_id: containerId } });
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2), ($3, $3)', [A, B, C]);
});
beforeEach(async () => {
  meta = newMeta();
  credsImpl = async () => ({ accountId: ACCT, token: 'tok' });
  vi.stubGlobal('fetch', fakeFetch);
  for (const tb of ['publish_reconciliations', 'post_events', 'post_variants', 'posts', 'notifications', 'scheduled_posts', 'publishing_controls']) {
    await admin.query(`delete from ${tb} where tenant_id = any($1)`, [[A, B, C]]);
  }
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.end();
});

describe('caminho feliz', () => {
  it('publica, grava o lease e o container, e deixa um post só', async () => {
    const id = await post(A);
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 1, failed: 0 });
    expect(meta.publishCalls).toBe(1);
    expect(meta.media).toHaveLength(1);
    const r = await row(id);
    expect(r).toMatchObject({ status: 'published', attempts: 0, last_error: null });
    expect(r.attempt_id).not.toBeNull();
    expect(r.meta_container_id).toBe('c1');
    expect(await posts(A)).toBe(1);
    expect(await recs(id)).toEqual([]);
  });
});

describe('resposta incerta do media_publish: nunca repete às cegas', () => {
  it('timeout DEPOIS da confirmação: a Meta publicou, o post é registrado e não duplica', async () => {
    meta.plan = ['timeout_after'];
    const id = await post(A, { caption: 'Bolo de pote' });
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 1, failed: 0 });
    expect(meta.publishCalls).toBe(1);
    expect(meta.media).toHaveLength(1);
    const r = await row(id);
    expect(r.status).toBe('published');
    expect(await posts(A)).toBe(1);
    expect(await recs(id)).toMatchObject([{ found: 'published', action: 'marked_published', container_id: 'c1' }]);
    const channels = (await admin.query('select channels from posts where scheduled_post_id = $1', [id])).rows[0].channels;
    expect(channels.instagram).toMatchObject({ id: 'm1', reconciled: true });
  });

  it('timeout ANTES da confirmação: container pronto e sem publicar, publica o mesmo container uma vez', async () => {
    meta.plan = ['timeout_before'];
    const id = await post(A);
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 1, failed: 0 });
    expect(meta.createCalls).toBe(1); // não criou outro container
    expect(meta.publishCalls).toBe(2);
    expect(meta.media).toHaveLength(1);
    expect((await row(id)).status).toBe('published');
    expect(await recs(id)).toMatchObject([{ found: 'not_published', action: 'published_now' }]);
  });

  it('5xx do media_publish também é incerto: confere antes de qualquer coisa', async () => {
    meta.plan = ['http500'];
    const id = await post(A);
    await runPublishDue();
    expect(meta.media).toHaveLength(1);
    expect((await row(id)).status).toBe('published');
  });

  it('Meta fora do ar na conferência: o post espera em publishing e ninguém publica de novo', async () => {
    const id = await post(A);
    // cai a rede quando o media_publish começa: o publicar, a resposta e a conferência falham
    meta.plan = [{ run: () => { meta.down = true; }, then: 'timeout_before' }];
    const res = await runPublishDue();
    expect(res).toMatchObject({ picked: 1, published: 0, failed: 1 });
    expect(meta.media).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'publishing', attempts: 1 });
    expect(await recs(id)).toMatchObject([{ found: 'unknown', action: 'waiting' }]);
    expect(await posts(A)).toBe(0);
  });
});

describe('queda entre a resposta da Meta e a gravação no banco (post preso em publishing)', () => {
  it('a Meta publicou: registra o post sem publicar de novo, e acha o id pela legenda', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'PUBLISHED', caption: 'Post que saiu' });
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, published: 1, failed: 0, errors: 0 });
    expect(meta.publishCalls).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'published', last_error: null });
    expect(await posts(A)).toBe(1);
    expect(await recs(id)).toMatchObject([{ found: 'published', action: 'marked_published' }]);
    expect((await admin.query('select channels from posts where scheduled_post_id = $1', [id])).rows[0].channels.instagram.id).toBe('m1');
  });

  it('post que a Meta publicou mas sem legenda igual: registra sem id e avisa na nota', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'PUBLISHED', caption: 'legenda presa' });
    meta.media[0].caption = 'outra coisa';
    await reconcileStalePublishing();
    const r = await row(id);
    expect(r.status).toBe('published');
    expect(r.last_error).toMatch(/id do post não foi encontrado/);
  });

  it('a Meta só criou o container: publica esse container uma vez', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'FINISHED' });
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, published: 1 });
    expect(meta.publishCalls).toBe(1);
    expect(meta.media).toHaveLength(1);
    expect((await row(id)).status).toBe('published');
    expect(await recs(id)).toMatchObject([{ found: 'not_published', action: 'published_now' }]);
  });

  it('caiu antes de existir container: nada foi ao ar, volta para a fila e o ciclo publica uma vez', async () => {
    const id = await stuck(A);
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, requeued: 1 });
    expect(await row(id)).toMatchObject({ status: 'scheduled', attempts: 1, attempt_id: null, meta_container_id: null });
    expect(await recs(id)).toMatchObject([{ found: 'no_container', action: 'requeued' }]);
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 1 });
    expect(meta.media).toHaveLength(1);
  });

  it('container com ERROR ou EXPIRED: nada publicado, volta para a fila', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'EXPIRED' });
    await reconcileStalePublishing();
    expect(await row(id)).toMatchObject({ status: 'scheduled', attempts: 1 });
    expect(meta.media).toHaveLength(0);
  });

  it('antes do prazo não mexe: quem está publicando agora segue em paz', async () => {
    const id = await post(A, { status: 'publishing', extra: { attempt_id: '00000000-0000-4000-8000-0000000000bb', publishing_started_at: new Date(), meta_container_id: null } });
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 0 });
    expect((await row(id)).status).toBe('publishing');
  });

  it('post de antes da migration (sem publishing_started_at) também é reconciliado, pelo updated_at', async () => {
    const id = await stuck(A);
    await admin.query('alter table scheduled_posts disable trigger scheduled_posts_touch');
    await admin.query('update scheduled_posts set publishing_started_at = null, updated_at = $2 where id = $1', [id, longAgo()]);
    await admin.query('alter table scheduled_posts enable trigger scheduled_posts_touch');
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, requeued: 1 });
  });

  it('Meta sem resposta a cada ciclo: depois de 3 conferências, vai para a pessoa conferir, com alerta', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'FINISHED' });
    meta.down = true;
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, waiting: 1 });
    expect(await row(id)).toMatchObject({ status: 'publishing', attempts: 1 });
    await reconcileStalePublishing();
    expect(await row(id)).toMatchObject({ status: 'publishing', attempts: 2 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, failed: 1 });
    const stuckLog = errors.mock.calls.map((c) => String(c[0])).find((l) => l.includes(publish.STUCK_LOG_MESSAGE));
    errors.mockRestore();
    expect(JSON.parse(stuckLog)).toMatchObject({ severity: 'ERROR', scope: 'publish', scheduled: id, tenant: A });
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 3 });
    expect((await row(id)).last_error).toMatch(/Confira no Instagram/);
    expect((await recs(id)).map((r) => r.action)).toEqual(['waiting', 'waiting', 'failed_for_review']);
    expect(await notices(A)).toContainEqual({ kind: 'publish.stuck', level: 'error' });
    expect(meta.media).toHaveLength(0);
  });

  it('sem conexão com o Instagram não dá para conferir: vai para a pessoa conferir, não repete', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'PUBLISHED' });
    credsImpl = async () => { throw new UserError('A conexão do Instagram venceu. Reconecte em Configurações, Redes.'); };
    expect(await reconcileStalePublishing()).toMatchObject({ failed: 1 });
    expect((await row(id)).status).toBe('failed');
    expect((await recs(id))[0]).toMatchObject({ found: 'unverifiable', action: 'failed_for_review' });
  });

  it('outro canal (sem como conferir): falha com aviso para conferir na rede', async () => {
    const id = await stuck(A);
    await admin.query("update scheduled_posts set channel = 'linkedin' where id = $1", [id]);
    expect(await reconcileStalePublishing()).toMatchObject({ failed: 1 });
    expect((await row(id)).last_error).toMatch(/LinkedIn/);
  });

  it('conta pausada: o reconciliador não chama a rede e o post espera', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'FINISHED' });
    await setPause(tenantDb(A), true, 'teste');
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 0 });
    expect(meta.publishCalls).toBe(0);
    expect((await row(id)).status).toBe('publishing');
  });
});

describe('seleção dos vencidos', () => {
  it('20 contas pausadas não seguram uma conta ativa', async () => {
    const paused = [];
    for (let i = 0; i < 21; i += 1) {
      const tid = `it-pubrel-p${i}`;
      paused.push(tid);
      await admin.query('insert into tenants (id, name) values ($1, $1) on conflict do nothing', [tid]);
      await post(tid, { scheduledFor: new Date(Date.now() - 3_600_000 - i * 1000) });
      await setPause(tenantDb(tid), true, 'teste');
    }
    const active = await post(A, { scheduledFor: new Date(Date.now() - 60_000) });
    try {
      const res = await runPublishDue();
      expect(res).toMatchObject({ picked: 1, published: 1 });
      expect((await row(active)).status).toBe('published');
      expect((await admin.query("select count(*)::int as n from scheduled_posts where tenant_id like 'it-pubrel-p%' and status = 'scheduled'")).rows[0].n).toBe(21);
    } finally {
      await admin.query("delete from scheduled_posts where tenant_id like 'it-pubrel-p%'");
      await admin.query("delete from publishing_controls where tenant_id like 'it-pubrel-p%'");
      await admin.query("delete from tenants where id like 'it-pubrel-p%'");
    }
  });

  it('uma conta com 30 vencidos não ocupa o lote todo: a outra sai no mesmo ciclo', async () => {
    for (let i = 0; i < 30; i += 1) await post(A, { scheduledFor: new Date(Date.now() - 7_200_000 + i * 1000) });
    const mine = [await post(B), await post(B)];
    const res = await runPublishDue();
    expect(res.picked).toBe(20);
    for (const id of mine) expect((await row(id)).status).toBe('published');
    const fromA = (await admin.query("select count(*)::int as n from scheduled_posts where tenant_id = $1 and status = 'published'", [A])).rows[0].n;
    expect(fromA).toBe(18);
    expect(meta.media).toHaveLength(20);
  });

  it('com uma conta só, o lote inteiro é dela (a justiça não cria teto)', async () => {
    for (let i = 0; i < 25; i += 1) await post(A, { scheduledFor: new Date(Date.now() - 7_200_000 + i * 1000) });
    expect((await runPublishDue()).picked).toBe(20);
  });

  it('hasPendingPublishes conta agendado e publicando, e ignora conta pausada', async () => {
    expect(await hasPendingPublishes()).toBe(false);
    await post(A, { scheduledFor: new Date(Date.now() + 86_400_000) });
    expect(await hasPendingPublishes()).toBe(true);
    await setPause(tenantDb(A), true, 'teste');
    expect(await hasPendingPublishes()).toBe(false);
    await post(B, { status: 'publishing', extra: { attempt_id: '00000000-0000-4000-8000-0000000000cc', publishing_started_at: new Date() } });
    expect(await hasPendingPublishes()).toBe(true);
  });
});

describe('concorrência', () => {
  it('dois ciclos ao mesmo tempo: cada post sai uma vez só', async () => {
    for (let i = 0; i < 6; i += 1) await post(A, { scheduledFor: new Date(Date.now() - 600_000 + i * 1000) });
    const [x, y] = await Promise.all([runPublishDue(), runPublishDue()]);
    expect(x.published + y.published).toBe(6);
    expect(meta.media).toHaveLength(6);
    expect(meta.publishCalls).toBe(6);
    expect(await posts(A)).toBe(6);
  });

  it('quem perde o lease não grava nada: o reconciliador assume enquanto a tentativa original ainda espera a Meta', async () => {
    let release;
    meta.plan = [{ gate: new Promise((r) => { release = r; }) }]; // o 1º media_publish fica pendurado
    const id = await post(A);
    const original = runPublishDue();
    // espera a tentativa original chegar ao media_publish
    for (let i = 0; i < 100 && meta.publishCalls === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(meta.publishCalls).toBe(1);
    // passou do prazo: o reconciliador vê o container FINISHED e publica por conta própria
    await admin.query('update scheduled_posts set publishing_started_at = $2 where id = $1', [id, longAgo()]);
    expect(await reconcileStalePublishing()).toMatchObject({ checked: 1, published: 1 });
    expect(meta.media).toHaveLength(1);
    // a tentativa original acorda: a Meta já publicou, o media_publish dela volta incerto
    release();
    await original;
    expect(meta.media).toHaveLength(1);
    expect(await posts(A)).toBe(1);
    expect((await row(id)).status).toBe('published');
  });
});

describe('falhas que não são da rede', () => {
  it('token vencido: falha na hora com o próximo passo, sem chamar a Meta nem repetir', async () => {
    credsImpl = async () => { throw new UserError('A conexão do Instagram venceu. Reconecte em Configurações, Redes.'); };
    const id = await post(A);
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 0, failed: 1 });
    expect(meta.createCalls).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 1 });
    expect((await row(id)).last_error).toMatch(/Reconecte/);
    expect(await notices(A)).toContainEqual({ kind: 'publish.failed', level: 'error' });
  });

  it('imagem inválida (400 na criação): tenta 3 vezes em 3 ciclos e falha, sem publicar nada', async () => {
    meta.createError = { status: 400, body: 'Only photo or video can be accepted as media type.' };
    const id = await post(A);
    for (const status of ['scheduled', 'scheduled', 'failed']) {
      await runPublishDue();
      expect((await row(id)).status).toBe(status);
    }
    expect(await row(id)).toMatchObject({ attempts: 3 });
    expect(meta.publishCalls).toBe(0);
    expect(await posts(A)).toBe(0);
  });

  it('publicar agora com resposta incerta: resolve na hora, sem duplicar', async () => {
    meta.plan = ['timeout_after'];
    const id = await post(A, { status: 'failed' });
    expect(await publishNow(tenantDb(A), id)).toEqual({ ok: true });
    expect(meta.media).toHaveLength(1);
    expect((await row(id)).status).toBe('published');
  });

  it('o container não grava (banco falha antes do media_publish): nada vai ao ar', async () => {
    const id = await post(A);
    // outro processo toma o lease logo depois do container criado: a gravação do container falha e a publicação para
    const realFetch = fakeFetch;
    vi.stubGlobal('fetch', async (input, init) => {
      const res = await realFetch(input, init);
      if (init?.method === 'POST' && new URL(input.toString()).pathname.endsWith('/media')) {
        await admin.query("update scheduled_posts set attempt_id = '00000000-0000-4000-8000-0000000000dd' where id = $1", [id]);
      }
      return res;
    });
    await runPublishDue();
    expect(meta.publishCalls).toBe(0);
    expect(meta.media).toHaveLength(0);
  });
});

// ── Modo ensaio (PUBLISH_MODE=rehearsal): vai até o container pronto e nunca chama media_publish ───────────
describe('modo ensaio', () => {
  const dryPosts = async (tenant) => (await admin.query('select is_dry_run, channels from posts where tenant_id = $1', [tenant])).rows;
  beforeEach(() => {
    process.env.PUBLISH_MODE = 'rehearsal';
  });
  afterEach(() => {
    delete process.env.PUBLISH_MODE;
  });

  it('cria e valida o container, não publica, e registra o post como ensaio com aviso próprio', async () => {
    const id = await post(A);
    expect(await runPublishDue()).toMatchObject({ picked: 1, published: 1, failed: 0 });
    expect(meta.createCalls).toBe(1);
    expect(meta.publishCalls).toBe(0);
    expect(meta.media).toHaveLength(0);
    const r = await row(id);
    expect(r).toMatchObject({ status: 'published', last_error: null });
    expect(r.meta_container_id).toBe('c1');
    const saved = await dryPosts(A);
    expect(saved).toHaveLength(1);
    expect(saved[0].is_dry_run).toBe(true);
    expect(saved[0].channels.instagram).toMatchObject({ id: 'rehearsal:c1', rehearsal: true });
    expect((await notices(A)).map((x) => x.kind)).toEqual(['publish.rehearsal']);
  });

  it('o ensaio não vira histórico: o post de ensaio fica fora de Publicados', async () => {
    await post(A);
    await runPublishDue();
    const { rows } = await admin.query('select count(*)::int as n from posts where tenant_id = $1 and is_dry_run = false', [A]);
    expect(rows[0].n).toBe(0);
  });

  it('imagem recusada pela Meta ainda falha no ensaio: é isso que ele valida', async () => {
    meta.createError = { status: 400, body: 'Only photo or video can be accepted as media type.' };
    const id = await post(A, { extra: { attempts: 2 } });
    await runPublishDue();
    expect(meta.publishCalls).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'failed' });
    expect(await posts(A)).toBe(0);
  });

  it('post preso com container pronto: a reconciliação NÃO publica, só registra o ensaio', async () => {
    const id = await stuck(A, { container: true, metaStatus: 'FINISHED' });
    const out = await reconcileStalePublishing();
    expect(out).toMatchObject({ checked: 1, published: 1 });
    expect(meta.publishCalls).toBe(0);
    expect(meta.media).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'published' });
    expect((await dryPosts(A))[0].is_dry_run).toBe(true);
  });

  it('LinkedIn no ensaio nem chama a rede e o post vira ensaio', async () => {
    const id = await post(A);
    await admin.query("update scheduled_posts set channel = 'linkedin', image_url = null, variation = variation || '{\"format\":\"text\"}' where id = $1", [id]);
    await runPublishDue();
    expect(meta.createCalls).toBe(0);
    expect(meta.publishCalls).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'published' });
    expect((await dryPosts(A))[0].channels.linkedin).toMatchObject({ rehearsal: true });
  });

  it('valor desconhecido falha a publicação em vez de postar, e nada vai à Meta', async () => {
    process.env.PUBLISH_MODE = 'ensaio';
    const id = await post(A, { extra: { attempts: 2 } });
    await runPublishDue();
    expect(meta.createCalls).toBe(0);
    expect(meta.publishCalls).toBe(0);
    const r = await row(id);
    expect(r.status).toBe('failed');
    expect(r.last_error).toMatch(/PUBLISH_MODE inválido/);
  });

  it('com PUBLISH_MODE=live publica de verdade, como sem a variável', async () => {
    process.env.PUBLISH_MODE = 'live';
    await post(A);
    await runPublishDue();
    expect(meta.publishCalls).toBe(1);
    expect(meta.media).toHaveLength(1);
    expect((await dryPosts(A))[0].is_dry_run).toBe(false);
  });
});
