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
const dataMock = { profile: { siteUrl: 'https://doceponto.com.br' }, read: [], error: null };
vi.mock('@/lib/company-profile', () => ({ getProfile: async () => dataMock.profile }));
vi.mock('@/lib/site-read/read', () => ({
  readSite: async (url) => {
    dataMock.read.push(url);
    if (dataMock.error) throw dataMock.error;
    return { url, name: 'Doce Ponto', description: null, colors: ['#B83262'], fonts: { heading: null, body: null }, logoUrl: null };
  },
}));

const { POST } = await import('../platform/src/app/api/profile/site-read/route.ts');
const { ForbiddenError } = await import('@/lib/session');
const { UserError } = await import('@/lib/errors');

const post = (body) => POST(new Request('http://app.test/api/profile/site-read', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { profile: { siteUrl: 'https://doceponto.com.br' }, read: [], error: null });
});

describe('POST /api/profile/site-read', () => {
  it('exige brand.manage e lê o endereço do corpo', async () => {
    const res = await post({ site_url: 'outro.com.br' });
    expect(res.status).toBe(200);
    expect((await res.json()).read.colors).toEqual(['#B83262']);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(dataMock.read).toEqual(['outro.com.br']);
  });

  it('sem endereço no corpo, usa o site do perfil; sem nenhum dos dois, pede o site', async () => {
    await post({});
    expect(dataMock.read).toEqual(['https://doceponto.com.br']);
    dataMock.profile = { siteUrl: null };
    const res = await post('lixo');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Informe o site/);
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
