import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = { error: null, calls: [] };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireUserPermission: async (permission) => {
      sessionMock.calls.push(permission);
      if (sessionMock.error) throw sessionMock.error;
      return { t: { tenantId: 'acme' }, user: { id: 'user-1' } };
    },
  };
});
const noticeMock = { marked: [] };
vi.mock('@/lib/notifications', () => ({ markNoticesSeen: async (_t, userId) => void noticeMock.marked.push(userId) }));

const { POST } = await import('../platform/src/app/api/notifications/read/route.ts');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  noticeMock.marked = [];
});

describe('POST /api/notifications/read', () => {
  it('pede content.view (todo papel tem avisos) e marca os da pessoa da sessão', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.view']);
    expect(noticeMock.marked).toEqual(['user-1']);
  });

  it('sem sessão 401 e sem permissão 403, sem marcar nada', async () => {
    sessionMock.error = new UnauthorizedError();
    expect((await POST()).status).toBe(401);
    sessionMock.error = new ForbiddenError();
    expect((await POST()).status).toBe(403);
    expect(noticeMock.marked).toEqual([]);
  });
});
