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
const dataMock = { facts: [], created: [], updated: [], deleted: [], confirmed: [], rejected: [], restored: [] };
vi.mock('@/lib/company-facts', () => ({
  listFacts: async () => dataMock.facts,
  createFact: async (_t, user, input) => (dataMock.created.push({ user: user.id, input }), { id: '11111111-2222-4333-8444-555555555555', ...input, active: true }),
  updateFact: async (_t, _u, patch) => void dataMock.updated.push(patch),
  deleteFact: async (_t, _u, id) => void dataMock.deleted.push(id),
  confirmFacts: async (_t, _u, ids, validUntil) => (dataMock.confirmed.push({ ids, validUntil }), ids.length),
  confirmFact: async (_t, _u, id, validUntil) => (dataMock.confirmed.push({ ids: [id], validUntil }), 1),
  rejectFact: async (_t, _u, id) => void dataMock.rejected.push(id),
  restoreFact: async (_t, _u, id) => void dataMock.restored.push(id),
}));

const { GET, POST } = await import('../platform/src/app/api/facts/route.ts');
const { PATCH, DELETE } = await import('../platform/src/app/api/facts/[id]/route.ts');
const { ForbiddenError } = await import('@/lib/session');

const ID = '11111111-2222-4333-8444-555555555555';
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { facts: [{ id: ID, kind: 'fact', text: 'x' }], created: [], updated: [], deleted: [], confirmed: [], rejected: [], restored: [] });
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

describe('confirmar, recusar e desfazer (SPEC 018)', () => {
  const ctx = { params: Promise.resolve({ id: ID }) };

  it('confirmar pede brand.manage, aceita prazo opcional e valida a data', async () => {
    const { POST } = await import('../platform/src/app/api/facts/[id]/confirm/route.ts');
    expect((await POST(new Request('http://app.test/x', json({})), ctx)).status).toBe(200);
    expect((await POST(new Request('http://app.test/x', json({ valid_until: null })), ctx)).status).toBe(200);
    expect((await POST(new Request('http://app.test/x', json({ valid_until: '2999-01-31' })), ctx)).status).toBe(200);
    expect(dataMock.confirmed).toEqual([
      { ids: [ID], validUntil: undefined },
      { ids: [ID], validUntil: null },
      { ids: [ID], validUntil: '2999-01-31' },
    ]);
    expect(sessionMock.calls).toEqual(['brand.manage', 'brand.manage', 'brand.manage']);
    const bad = await POST(new Request('http://app.test/x', json({ valid_until: '2000-01-01' })), ctx);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: 'valid_until' });
    expect((await POST(new Request('http://app.test/x', json({})), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
  });

  it('o corpo não consegue mudar o estado: status e quem propôs são ignorados', async () => {
    const { POST } = await import('../platform/src/app/api/facts/[id]/confirm/route.ts');
    await POST(new Request('http://app.test/x', json({ status: 'rejected', proposed_by: 'agent', approved_by: 'outra' })), ctx);
    expect(dataMock.confirmed).toEqual([{ ids: [ID], validUntil: undefined }]);
  });

  it('recusar e desfazer pedem brand.manage e validam o id', async () => {
    const reject = await import('../platform/src/app/api/facts/[id]/reject/route.ts');
    const restore = await import('../platform/src/app/api/facts/[id]/restore/route.ts');
    expect((await reject.POST(new Request('http://app.test/x', json({})), ctx)).status).toBe(200);
    expect((await restore.POST(new Request('http://app.test/x', json({})), ctx)).status).toBe(200);
    expect(dataMock.rejected).toEqual([ID]);
    expect(dataMock.restored).toEqual([ID]);
    expect((await reject.POST(new Request('http://app.test/x', json({})), { params: Promise.resolve({ id: '1' }) })).status).toBe(404);
    expect(sessionMock.calls).toEqual(['brand.manage', 'brand.manage', 'brand.manage']);
  });

  it('confirmar vários exige ids marcados; "todos" não existe', async () => {
    const { POST } = await import('../platform/src/app/api/facts/confirm-many/route.ts');
    const ok = await POST(new Request('http://app.test/x', json({ ids: [ID] })));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, confirmed: 1 });
    expect((await POST(new Request('http://app.test/x', json({ all: true })))).status).toBe(400);
    expect((await POST(new Request('http://app.test/x', json({ ids: [] })))).status).toBe(400);
    expect(dataMock.confirmed).toEqual([{ ids: [ID], validUntil: undefined }]);
  });

  it('sem permissão, nada é gravado (403)', async () => {
    const confirm = await import('../platform/src/app/api/facts/[id]/confirm/route.ts');
    const many = await import('../platform/src/app/api/facts/confirm-many/route.ts');
    sessionMock.error = new ForbiddenError('sem permissão');
    expect((await confirm.POST(new Request('http://app.test/x', json({})), ctx)).status).toBe(403);
    expect((await many.POST(new Request('http://app.test/x', json({ ids: [ID] })))).status).toBe(403);
    expect(dataMock.confirmed).toEqual([]);
  });
});
