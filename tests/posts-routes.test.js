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
    requireSession: async () => ({ t: { tenantId: 'acme' }, role: 'creator', user: { id: 'u1', name: 'Ana' } }),
  };
});
const dataMock = { created: [], woke: 0, progress: null, retried: [] };
vi.mock('@/lib/post-requests', async (orig) => {
  const real = await orig();
  return {
    ...real,
    createPostRequest: async (_t, user, input) => (dataMock.created.push({ user: user?.id, input }), { id: '11111111-2222-4333-8444-555555555555' }),
    wakeWorker: () => void (dataMock.woke += 1),
    postProgress: async (_t, id) => (dataMock.progress && dataMock.progress.id === id ? dataMock.progress : null),
    retryPostRequest: async (_t, id) => void dataMock.retried.push(id),
  };
});

const { POST } = await import('../platform/src/app/api/posts/route.ts');
const { GET } = await import('../platform/src/app/api/posts/[id]/route.ts');
const { POST: RETRY } = await import('../platform/src/app/api/posts/[id]/retry/route.ts');
const { ForbiddenError } = await import('@/lib/session');

const ID = '11111111-2222-4333-8444-555555555555';
const post = (body) => POST(new Request('http://app.test/api/posts', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { created: [], woke: 0, progress: null, retried: [] });
});

describe('POST /api/posts', () => {
  it('pede content.create, grava o pedido com quem pediu, acorda o worker e devolve 201', async () => {
    const res = await post({ idea: 'bolo pronto', kind: 'informativo', tenant_id: 'outra' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID });
    expect(sessionMock.calls).toEqual(['content.create']);
    expect(dataMock.created).toEqual([{ user: 'u1', input: { idea: 'bolo pronto', kind: 'informativo' } }]);
    expect(dataMock.woke).toBe(1);
  });

  it('400 com o campo quando a ideia falta; 403 sem permissão, sem gravar', async () => {
    const res = await post({ idea: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'idea' });
    sessionMock.error = new ForbiddenError();
    expect((await post({ idea: 'x' })).status).toBe(403);
    expect(dataMock.created).toEqual([]);
    expect(dataMock.woke).toBe(0);
  });
});

describe('GET /api/posts/[id] e retry', () => {
  it('devolve o andamento; id inválido ou desconhecido é 404', async () => {
    dataMock.progress = { id: ID, status: 'generating', step: 'writer' };
    const ok = await GET(new Request('http://app.test'), { params: Promise.resolve({ id: ID }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'generating', step: 'writer' });
    expect((await GET(new Request('http://app.test'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    expect((await GET(new Request('http://app.test'), { params: Promise.resolve({ id: '22222222-2222-4333-8444-555555555555' }) })).status).toBe(404);
    expect(sessionMock.calls).toEqual(['content.view', 'content.view', 'content.view']);
  });

  it('tentar de novo pede content.create e acorda o worker', async () => {
    const res = await RETRY(new Request('http://app.test', { method: 'POST' }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(dataMock.retried).toEqual([ID]);
    expect(dataMock.woke).toBe(1);
    expect(sessionMock.calls).toEqual(['content.create']);
  });
});
