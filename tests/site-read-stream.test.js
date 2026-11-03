import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = { error: null, calls: [] };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requirePermission: async (permission) => {
      sessionMock.calls.push(permission);
      if (sessionMock.error) throw sessionMock.error;
      return { tenantId: 'acme' };
    },
  };
});
const data = { instagram: { state: 'not_connected', pages: [] }, profile: { siteUrl: 'https://doceponto.com.br' }, limited: false, script: null, reads: [] };
vi.mock('@/lib/company-profile', () => ({ getProfile: async () => data.profile }));
vi.mock('@/lib/rate-limit', () => ({
  hit: async () => ({ allowed: !data.limited, hits: 9, retryAfterS: 120 }),
  tooMany: () => new Response(JSON.stringify({ error: 'Muitas leituras.' }), { status: 429 }),
}));
vi.mock('@/lib/vertex', () => ({ vertexClient: () => ({ fake: 'model' }) }));
vi.mock('@/lib/site-read/instagram', () => ({
  readInstagramPosts: async (_t, deps) => {
    if (data.instagram.state !== 'not_connected') deps?.onReading?.();
    return data.instagram;
  },
}));
vi.mock('@/lib/site-read/understand', () => ({
  understandSite: async (site, deps) => {
    data.reads.push(site);
    await data.script?.(deps.probe);
    return { read: { url: site, name: 'Doce Ponto', colors: ['#B83262'], fonts: { heading: null, body: null }, description: null, logoUrl: null }, understanding: null, notice: null, instagram: { state: 'not_connected', count: 0 } };
  },
}));
vi.mock('@/lib/log', async (orig) => ({ ...(await orig()), log: () => {}, logError: () => {} }));

const { POST } = await import('../platform/src/app/api/profile/site-read/stream/route.ts');
const { createSseReader } = await import('../platform/src/lib/site-read/events.ts');
const { ForbiddenError } = await import('@/lib/session');
const { UserError } = await import('@/lib/errors');

const call = (body) => POST(new Request('http://app.test/api/profile/site-read/stream', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

async function events(res) {
  const out = [];
  const reader = createSseReader((e) => out.push(e));
  const decoder = new TextDecoder();
  const body = res.body.getReader();
  for (;;) {
    const { done, value } = await body.read();
    if (done) break;
    reader.push(decoder.decode(value, { stream: true }));
  }
  reader.end();
  return out;
}

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(data, { instagram: { state: 'not_connected', pages: [] }, profile: { siteUrl: 'https://doceponto.com.br' }, limited: false, script: null, reads: [] });
});

describe('POST /api/profile/site-read/stream', () => {
  it('abre o fluxo com os cabeçalhos certos e entrega começo, passos e fim, nesta ordem', async () => {
    data.script = async (probe) => {
      probe({ type: 'started', kind: 'site', label: 'Abrindo doceponto.com.br' });
      probe({ type: 'result', kind: 'site' });
      probe({ type: 'started', kind: 'page', label: 'Lendo uma página do site', url: 'https://doceponto.com.br/sobre' });
      probe({ type: 'failed', kind: 'page', message: 'Esta página não abriu.', url: 'https://doceponto.com.br/sobre' });
      probe({ type: 'result', kind: 'logo', logoUrl: null });
    };
    const res = await call({ site_url: 'outro.com.br' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-transform/);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    const got = await events(res);
    expect(got.map((e) => e.type)).toEqual(['read.started', 'step.started', 'step.result', 'step.started', 'step.failed', 'step.result', 'read.done']);
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(got[0].site).toBe('outro.com.br');
    expect(got.at(-1).result.read.name).toBe('Doce Ponto');
    // o resumo de tempo conta os passos que começaram e terminaram
    expect(got.at(-1).timing.steps.map((s) => `${s.kind}:${s.ok}`)).toEqual(['site:true', 'page:false']);
    expect(data.reads).toEqual(['outro.com.br']);
  });

  it('sem endereço no corpo usa o site do perfil; sem nenhum dos dois, 400 em JSON e nada é lido', async () => {
    await events(await call({}));
    expect(data.reads).toEqual(['https://doceponto.com.br']);
    data.profile = { siteUrl: null };
    const res = await call('lixo');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Informe o site/);
  });

  it('antes de abrir o fluxo: 403 sem permissão e 429 no teto por hora, em JSON, sem ler nada', async () => {
    sessionMock.error = new ForbiddenError('Sem permissão.');
    expect((await call({ site_url: 'x.com.br' })).status).toBe(403);
    sessionMock.error = null;
    data.limited = true;
    expect((await call({ site_url: 'x.com.br' })).status).toBe(429);
    expect(data.reads).toEqual([]);
  });

  it('erro da leitura depois de aberto: evento read.failed com a frase da pessoa, e o fluxo fecha', async () => {
    data.script = async () => {
      throw new UserError('O site não respondeu a tempo. Confira o endereço.');
    };
    const got = await events(await call({ site_url: 'x.com.br' }));
    expect(got.map((e) => e.type)).toEqual(['read.started', 'read.failed']);
    expect(got[1].message).toBe('O site não respondeu a tempo. Confira o endereço.');
  });

  it('erro nosso não vaza detalhe: a pessoa lê a mensagem genérica', async () => {
    data.script = async () => {
      throw new Error('ECONNRESET 10.0.0.7 segredo');
    };
    const got = await events(await call({ site_url: 'x.com.br' }));
    expect(got[1].type).toBe('read.failed');
    expect(got[1].message).not.toMatch(/10\.0\.0\.7|segredo/);
  });

  it('Instagram conectado: o passo aparece no fluxo, e só para quem conectou', async () => {
    data.instagram = { state: 'ok', pages: [{ url: 'https://www.instagram.com/p/A/', text: 'legenda', source: 'instagram' }] };
    const got = await events(await call({ site_url: 'x.com.br' }));
    const ig = got.filter((e) => 'kind' in e && e.kind === 'instagram');
    expect(ig.map((e) => e.type)).toEqual(['step.started', 'step.result']);
    expect(ig[1]).toMatchObject({ state: 'ok', count: 1 });
    data.instagram = { state: 'not_connected', pages: [] };
    expect((await events(await call({ site_url: 'x.com.br' }))).some((e) => 'kind' in e && e.kind === 'instagram')).toBe(false);
  });

  it('Instagram vencido ou com falha: aviso do passo, e a leitura termina igual', async () => {
    data.instagram = { state: 'expired', pages: [] };
    const got = await events(await call({ site_url: 'x.com.br' }));
    const failed = got.find((e) => e.type === 'step.failed' && e.kind === 'instagram');
    expect(failed.message).toMatch(/venceu/);
    expect(got.at(-1).type).toBe('read.done');
  });
});
