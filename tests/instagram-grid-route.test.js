// GET /api/instagram/grid: quem vê o conteúdo lê; sem sessão 401, sem permissão 403; nunca devolve o token.
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
vi.mock('@/lib/instagram-grid', () => ({ readGrid: async () => ({ source: 'meta', items: [{ id: 'a', type: 'IMAGE', imageUrl: 'https://x.cdninstagram.com/a.jpg', permalink: null, timestamp: null }], reason: null }) }));

const route = await import('../platform/src/app/api/instagram/grid/route.ts');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');

beforeEach(() => Object.assign(sessionMock, { error: null, calls: [] }));

describe('GET /api/instagram/grid', () => {
  it('exige content.view e devolve a grade', async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.view']);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it('401 sem sessão e 403 sem permissão', async () => {
    sessionMock.error = new UnauthorizedError('sessão');
    expect((await route.GET()).status).toBe(401);
    sessionMock.error = new ForbiddenError('sem permissão');
    expect((await route.GET()).status).toBe(403);
  });
});
