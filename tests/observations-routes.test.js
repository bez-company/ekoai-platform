// A rota que liga e desliga as observações do público (SPEC 022, BEZ-206): só quem gere a marca (403 para
// criador e leitor), o corpo é validado antes de qualquer I/O e a pessoa que decidiu vai junto.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = { error: null, calls: [], user: { id: 'u-1' } };
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
    requireSession: async () => ({ t: { tenantId: 'acme' }, role: 'admin', user: sessionMock.user }),
  };
});
const dataMock = { calls: [], error: null };
vi.mock('@/lib/observations', () => ({
  setObservation: async (t, userId, key, enabled) => {
    dataMock.calls.push({ tenant: t.tenantId, userId, key, enabled });
    if (dataMock.error) throw dataMock.error;
  },
}));

const { PUT } = await import('../platform/src/app/api/learning/observations/route.ts');
const { ForbiddenError } = await import('@/lib/session');

const put = (body) => PUT(new Request('http://app.test', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [], user: { id: 'u-1' } });
  Object.assign(dataMock, { calls: [], error: null });
});

describe('observações do público: rota', () => {
  it('liga e desliga pedindo brand.manage, com a pessoa que decidiu', async () => {
    const res = await put({ key: 'content', enabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: 'content', enabled: true });
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(dataMock.calls).toEqual([{ tenant: 'acme', userId: 'u-1', key: 'content', enabled: true }]);
    await put({ key: 'audience', enabled: false });
    expect(dataMock.calls[1]).toMatchObject({ key: 'audience', enabled: false });
  });

  it('criador e leitor recebem 403 e nada é gravado', async () => {
    sessionMock.error = new ForbiddenError('sem permissão');
    const res = await put({ key: 'content', enabled: true });
    expect(res.status).toBe(403);
    expect(dataMock.calls).toEqual([]);
  });

  it('chave inventada, booleano que não é booleano ou corpo quebrado: 400 sem gravar', async () => {
    for (const body of [{ key: 'hours', enabled: true }, { key: 'content', enabled: 'sim' }, {}, 'não é json']) {
      const res = await put(body);
      expect(res.status).toBe(400);
    }
    expect(dataMock.calls).toEqual([]);
  });
});
