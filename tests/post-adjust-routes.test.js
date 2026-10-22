import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = { error: null, calls: [] };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  const gate = async (permission) => {
    sessionMock.calls.push(permission);
    if (sessionMock.error) throw sessionMock.error;
  };
  return { UnauthorizedError, ForbiddenError, requirePermission: async (permission) => (await gate(permission), { tenantId: 'acme' }) };
});
const dataMock = { directions: [], rewrites: [], woke: 0, rewriteError: null };
vi.mock('@/lib/post-requests', async (orig) => ({ ...(await orig()), requestAnotherDirection: async (_t, id) => void dataMock.directions.push(id), wakeWorker: () => void (dataMock.woke += 1) }));
vi.mock('@/lib/generation', () => ({
  rewriteCaption: async (_t, _deps, input) => {
    if (dataMock.rewriteError) throw dataMock.rewriteError;
    dataMock.rewrites.push(input);
    return { caption: `${input.mode}: ${input.caption}`, hashtags: ['bolo'] };
  },
}));
vi.mock('@/lib/vertex', () => ({ vertexClient: () => ({ config: {} }) }));

const { POST: DIRECTION } = await import('../platform/src/app/api/posts/[id]/direction/route.ts');
const { POST: CAPTION } = await import('../platform/src/app/api/posts/[id]/caption/route.ts');
const { UserError } = await import('@/lib/errors');

const ID = '11111111-2222-4333-8444-555555555555';
const params = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { directions: [], rewrites: [], woke: 0, rewriteError: null });
});

describe('outra direção e atalhos de legenda', () => {
  it('outra direção pede content.edit, reenfileira e acorda o worker', async () => {
    const res = await DIRECTION(new Request('http://app.test', { method: 'POST' }), params());
    expect(res.status).toBe(200);
    expect(dataMock.directions).toEqual([ID]);
    expect(dataMock.woke).toBe(1);
    expect(sessionMock.calls).toEqual(['content.edit']);
    expect((await DIRECTION(new Request('http://app.test', { method: 'POST' }), params('x'))).status).toBe(404);
  });

  it('atalho de legenda valida o modo e devolve a legenda nova; erro de domínio vira 400', async () => {
    const res = await CAPTION(new Request('http://app.test', { method: 'POST', body: JSON.stringify({ mode: 'shorter', caption: 'Legenda longa', hashtags: ['bolo', 'x'] }) }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ caption: 'shorter: Legenda longa', hashtags: ['bolo'] });
    expect(dataMock.rewrites[0]).toMatchObject({ briefId: ID, mode: 'shorter', hashtags: ['bolo', 'x'] });
    expect((await CAPTION(new Request('http://app.test', { method: 'POST', body: JSON.stringify({ mode: 'louder', caption: 'x' }) }), params())).status).toBe(400);
    expect((await CAPTION(new Request('http://app.test', { method: 'POST', body: JSON.stringify({ mode: 'cta', caption: '' }) }), params())).status).toBe(400);
    dataMock.rewriteError = new UserError('A nova legenda não passou no revisor');
    const refused = await CAPTION(new Request('http://app.test', { method: 'POST', body: JSON.stringify({ mode: 'cta', caption: 'x' }) }), params());
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'A nova legenda não passou no revisor' });
  });
});
