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
const dataMock = { facts: [], created: [], updated: [], deleted: [] };
vi.mock('@/lib/company-facts', () => ({
  listFacts: async () => dataMock.facts,
  createFact: async (_t, user, input) => (dataMock.created.push({ user: user.id, input }), { id: '11111111-2222-4333-8444-555555555555', ...input, active: true }),
  updateFact: async (_t, _u, patch) => void dataMock.updated.push(patch),
  deleteFact: async (_t, _u, id) => void dataMock.deleted.push(id),
}));

const { GET, POST } = await import('../platform/src/app/api/facts/route.ts');
const { PATCH, DELETE } = await import('../platform/src/app/api/facts/[id]/route.ts');
const { ForbiddenError } = await import('@/lib/session');

const ID = '11111111-2222-4333-8444-555555555555';
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { facts: [{ id: ID, kind: 'fact', text: 'x' }], created: [], updated: [], deleted: [] });
});

describe('/api/facts', () => {
  it('GET pede profile.view e lista', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facts: [{ id: ID, kind: 'fact', text: 'x' }] });
    expect(sessionMock.calls).toEqual(['profile.view']);
  });

  it('POST pede brand.manage, valida e grava com quem fez', async () => {
    const res = await POST(new Request('http://app.test/api/facts', json({ kind: 'fact', text: ' Entrega no dia ', source: 'site', tenant_id: 'outra' })));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ fact: { text: 'Entrega no dia', source: 'site' } });
    expect(dataMock.created).toEqual([{ user: 'u1', input: { kind: 'fact', text: 'Entrega no dia', source: 'site', source_note: null, category: 'outro', valid_until: null } }]);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    const bad = await POST(new Request('http://app.test/api/facts', json({ kind: 'fact', text: '' })));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: 'text' });
  });

  it('criador (sem brand.manage) recebe 403 e nada grava', async () => {
    sessionMock.error = new ForbiddenError();
    expect((await POST(new Request('http://app.test/api/facts', json({ kind: 'fact', text: 'x' })))).status).toBe(403);
    expect(dataMock.created).toEqual([]);
  });
});

describe('/api/facts/[id]', () => {
  it('PATCH liga, desliga ou edita; DELETE apaga; id inválido é 404', async () => {
    const res = await PATCH(new Request('http://app.test', { method: 'PATCH', body: JSON.stringify({ active: false, id: 'ignorado' }) }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(dataMock.updated).toEqual([{ id: ID, active: false }]);
    const nothing = await PATCH(new Request('http://app.test', { method: 'PATCH', body: '{}' }), { params: Promise.resolve({ id: ID }) });
    expect(nothing.status).toBe(400);
    expect((await DELETE(new Request('http://app.test', { method: 'DELETE' }), { params: Promise.resolve({ id: ID }) })).status).toBe(200);
    expect(dataMock.deleted).toEqual([ID]);
    expect((await DELETE(new Request('http://app.test', { method: 'DELETE' }), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    expect(sessionMock.calls).toEqual(['brand.manage', 'brand.manage', 'brand.manage', 'brand.manage']);
  });
});
