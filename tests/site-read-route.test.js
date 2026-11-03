import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = { error: null, calls: [] };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  const gate = async (permission) => {
    sessionMock.calls.push(permission);
    if (sessionMock.error) throw sessionMock.error;
  };
  return {
    UnauthorizedError,
    ForbiddenError,
    requirePermission: async (permission) => (await gate(permission), { tenantId: 'acme' }),
    requireUserPermission: async (permission) => (await gate(permission), { t: { tenantId: 'acme' }, user: { id: 'u1', name: 'Ana' } }),
  };
});
const dataMock = { instagram: { state: 'not_connected', pages: [] }, instagramFor: [], profile: { siteUrl: 'https://doceponto.com.br' }, read: [], error: null, limited: false, applied: [], applyError: null };
vi.mock('@/lib/company-profile', () => ({ getProfile: async () => dataMock.profile }));
vi.mock('@/lib/rate-limit', () => ({
  hit: async () => ({ allowed: !dataMock.limited, hits: 9, retryAfterS: 120 }),
  tooMany: () => new Response(JSON.stringify({ error: 'Muitas leituras. Tente de novo em 2 minutos.' }), { status: 429 }),
}));
vi.mock('@/lib/vertex', () => ({ vertexClient: () => ({ fake: 'model' }) }));
vi.mock('@/lib/site-read/instagram', () => ({ readInstagramPosts: async (t) => (dataMock.instagramFor.push(t.tenantId), dataMock.instagram) }));
vi.mock('@/lib/site-read/understand', () => ({
  understandSite: async (url, deps) => {
    dataMock.read.push([url, deps.tenantId, deps.model, await deps.instagram]);
    if (dataMock.error) throw dataMock.error;
    return { read: { url, name: 'Doce Ponto', colors: ['#B83262'], fonts: { heading: null, body: null }, description: null, logoUrl: null }, understanding: null, notice: null };
  },
}));
vi.mock('@/lib/site-read/apply', () => ({
  applySiteRead: async (_t, _u, input) => {
    if (dataMock.applyError) throw dataMock.applyError;
    dataMock.applied.push(input);
    return { applied: { about: true, voice: false, differentiators: 0, pains: 0, facts: input.facts.length, logo: false }, skipped: [] };
  },
}));

const { POST } = await import('../platform/src/app/api/profile/site-read/route.ts');
const { POST: APPLY } = await import('../platform/src/app/api/profile/site-read/apply/route.ts');
const { ForbiddenError } = await import('@/lib/session');
const { UserError } = await import('@/lib/errors');

const post = (body) => POST(new Request('http://app.test/api/profile/site-read', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const apply = (body) => APPLY(new Request('http://app.test/api/profile/site-read/apply', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { instagram: { state: 'not_connected', pages: [] }, instagramFor: [], profile: { siteUrl: 'https://doceponto.com.br' }, read: [], error: null, limited: false, applied: [], applyError: null });
});

describe('POST /api/profile/site-read', () => {
  it('exige brand.manage, lê o endereço do corpo e passa a conta e o modelo', async () => {
    const res = await post({ site_url: 'outro.com.br' });
    expect(res.status).toBe(200);
    expect((await res.json()).read.colors).toEqual(['#B83262']);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(dataMock.read).toEqual([['outro.com.br', 'acme', { fake: 'model' }, { state: 'not_connected', pages: [] }]]);
  });

  it('lê as legendas do Instagram da própria conta e passa para a leitura', async () => {
    dataMock.instagram = { state: 'ok', pages: [{ url: 'https://www.instagram.com/p/A/', text: 'legenda', source: 'instagram' }] };
    await post({ site_url: 'x.com.br' });
    expect(dataMock.instagramFor).toEqual(['acme']);
    expect(dataMock.read[0][3].state).toBe('ok');
  });

  it('sem endereço no corpo, usa o site do perfil; sem nenhum dos dois, pede o site', async () => {
    await post({});
    expect(dataMock.read[0][0]).toBe('https://doceponto.com.br');
    dataMock.profile = { siteUrl: null };
    const res = await post('lixo');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Informe o site/);
  });

  it('teto por hora: passou do limite, responde 429 e não lê nada', async () => {
    dataMock.limited = true;
    const res = await post({ site_url: 'x.com.br' });
    expect(res.status).toBe(429);
    expect(dataMock.read).toEqual([]);
  });

  it('papel sem permissão: 403 e nada é lido; erro de leitura volta como 400 com a mensagem', async () => {
    sessionMock.error = new ForbiddenError('Sem permissão.');
    expect((await post({ site_url: 'x.com.br' })).status).toBe(403);
    expect(dataMock.read).toEqual([]);
    sessionMock.error = null;
    dataMock.error = new UserError('O site não respondeu a tempo.');
    const res = await post({ site_url: 'x.com.br' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('O site não respondeu a tempo.');
  });
});

describe('POST /api/profile/site-read/apply', () => {
  it('exige brand.manage e aplica o corpo já com a forma certa', async () => {
    const res = await apply({ about: { offering: ' Bolos ' }, facts: [{ text: 'Fato', category: 'outro', source_note: 'https://a.com/' }], admin: true });
    expect(res.status).toBe(200);
    expect((await res.json()).applied.facts).toBe(1);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(dataMock.applied[0]).toMatchObject({ about: { offering: 'Bolos' }, facts: [{ text: 'Fato' }] });
    expect(dataMock.applied[0]).not.toHaveProperty('admin');
  });

  it('403 sem permissão, 400 com a mensagem do erro de domínio, corpo inválido vira "nada para aplicar" pelo domínio', async () => {
    sessionMock.error = new ForbiddenError('Sem permissão.');
    expect((await apply({ about: { offering: 'x' } })).status).toBe(403);
    expect(dataMock.applied).toEqual([]);
    sessionMock.error = null;
    dataMock.applyError = new UserError('Preencha primeiro o que a empresa vende e para quem.');
    const res = await apply('lixo');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Preencha primeiro/);
  });
});
