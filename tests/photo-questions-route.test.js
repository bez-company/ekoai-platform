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
const lib = { inputs: [] };
vi.mock('@/lib/photo-questions', () => ({ photoQuestions: async (_t, input) => (lib.inputs.push(input), { questions: [], inferredUsage: null, describe: false }) }));

const { POST } = await import('../platform/src/app/api/posts/photo-questions/route.ts');
const { ForbiddenError } = await import('@/lib/session');
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const call = (body) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  lib.inputs = [];
});

describe('POST /api/posts/photo-questions', () => {
  it('pede content.create e repassa a foto e o pedido', async () => {
    const res = await call({ assetId: ID, idea: 'use de fundo' });
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.create']);
    expect(lib.inputs).toEqual([{ assetId: ID, idea: 'use de fundo' }]);
  });

  it('sem foto é 400; leitor é 403', async () => {
    expect((await call({ idea: 'x' })).status).toBe(400);
    sessionMock.error = new ForbiddenError();
    expect((await call({ assetId: ID })).status).toBe(403);
  });
});
