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

const ID = '11111111-2222-4333-8444-555555555555';
const dataMock = { created: [], updated: [], changed: [], error: null, current: { startDate: '2026-10-12', endDate: '2026-12-15' } };
vi.mock('@/lib/campaigns', () => {
  const fail = async () => {
    if (dataMock.error) throw dataMock.error;
  };
  return {
    listCampaigns: async () => [{ id: ID, name: 'Encomendas' }],
    getCampaign: async () => (await fail(), dataMock.current),
    createCampaign: async (_t, user, input) => (dataMock.created.push({ user: user.id, input }), { id: ID, status: 'draft', ...input }),
    updateCampaign: async (_t, user, id, patch) => (await fail(), dataMock.updated.push({ user: user.id, id, patch }), { id, ...patch }),
    changeCampaign: async (_t, user, id, action) => (await fail(), dataMock.changed.push({ user: user.id, id, action }), { id, status: 'x' }),
    campaignProgress: async (_t, id) => (await fail(), { id, published: 4 }),
  };
});

const list = await import('../platform/src/app/api/campaigns/route.ts');
const one = await import('../platform/src/app/api/campaigns/[id]/route.ts');
const confirm = await import('../platform/src/app/api/campaigns/[id]/confirm/route.ts');
const pause = await import('../platform/src/app/api/campaigns/[id]/pause/route.ts');
const resume = await import('../platform/src/app/api/campaigns/[id]/resume/route.ts');
const end = await import('../platform/src/app/api/campaigns/[id]/end/route.ts');
const progress = await import('../platform/src/app/api/campaigns/[id]/progress/route.ts');
const { ForbiddenError } = await import('@/lib/session');
const { ConflictError, NotFoundError } = await import('../platform/src/lib/errors.ts');

const ctx = { params: Promise.resolve({ id: ID }) };
const json = (body, method = 'POST') => ({ method, body: JSON.stringify(body) });
const body = (over = {}) => ({
  name: 'Encomendas de fim de ano',
  kind: 'vender',
  objective: 'Vender as caixas de fim de ano',
  offering: 'Caixas de panetone',
  audience: 'Famílias',
  start_date: '2026-10-12',
  end_date: '2099-12-15',
  ...over,
});

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { created: [], updated: [], changed: [], error: null });
});

describe('/api/campaigns', () => {
  it('GET pede content.view; POST pede brand.manage, valida e grava com quem fez', async () => {
    expect((await list.GET()).status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.view']);
    const res = await list.POST(new Request('http://app.test/x', json(body({ tenant_id: 'outra', status: 'active' }))));
    expect(res.status).toBe(201);
    expect(sessionMock.calls).toEqual(['content.view', 'brand.manage']);
    expect(dataMock.created).toHaveLength(1);
    expect(dataMock.created[0].user).toBe('u1');
    expect(Object.keys(dataMock.created[0].input)).not.toContain('tenant_id');
    expect(Object.keys(dataMock.created[0].input)).not.toContain('status');
    const bad = await list.POST(new Request('http://app.test/x', json(body({ objective: '' }))));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Diga o que você quer alcançar, em uma frase.', field: 'objective' });
    expect(dataMock.created).toHaveLength(1);
  });

  it('sem permissão: 403 e nada é gravado', async () => {
    sessionMock.error = new ForbiddenError('sem permissão');
    expect((await list.POST(new Request('http://app.test/x', json(body())))).status).toBe(403);
    expect(dataMock.created).toEqual([]);
  });
});

describe('/api/campaigns/[id]', () => {
  it('PATCH valida contra o que a campanha já tem e grava só o enviado', async () => {
    const ok = await one.PATCH(new Request('http://app.test/x', json({ audience: 'Noivas', status: 'active' }, 'PATCH')), ctx);
    expect(ok.status).toBe(200);
    expect(dataMock.updated).toEqual([{ user: 'u1', id: ID, patch: { audience: 'Noivas' } }]);
    const window = await one.PATCH(new Request('http://app.test/x', json({ end_date: '2026-10-01' }, 'PATCH')), ctx);
    expect(window.status).toBe(400);
    expect(await window.json()).toMatchObject({ field: 'end_date' });
    expect((await one.PATCH(new Request('http://app.test/x', json({}, 'PATCH')), ctx)).status).toBe(400);
    expect((await one.PATCH(new Request('http://app.test/x', json({ audience: 'x' }, 'PATCH')), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    expect(dataMock.updated).toHaveLength(1);
  });

  it('campanha de outra conta ou apagada: 404; encerrada: 409', async () => {
    dataMock.error = new NotFoundError('Campanha não encontrada. Recarregue a página.');
    expect((await one.PATCH(new Request('http://app.test/x', json({ audience: 'x' }, 'PATCH')), ctx)).status).toBe(404);
    dataMock.error = new ConflictError('Campanha encerrada não muda.');
    expect((await one.PATCH(new Request('http://app.test/x', json({ audience: 'x' }, 'PATCH')), ctx)).status).toBe(409);
  });
});

describe('confirmar, pausar, retomar e encerrar', () => {
  const routes = { confirm, pause, resume, end };

  it('cada ação pede brand.manage e chama a mudança certa com quem fez', async () => {
    for (const [action, route] of Object.entries(routes)) {
      expect((await route.POST(new Request('http://app.test/x', { method: 'POST' }), ctx)).status).toBe(200);
    }
    expect(dataMock.changed.map((c) => [c.action, c.user, c.id])).toEqual([['confirm', 'u1', ID], ['pause', 'u1', ID], ['resume', 'u1', ID], ['end', 'u1', ID]]);
    expect(sessionMock.calls).toEqual(['brand.manage', 'brand.manage', 'brand.manage', 'brand.manage']);
  });

  it('já existe outra ativa: 409 com a mensagem; id inválido: 404; sem permissão: 403', async () => {
    dataMock.error = new ConflictError('Já existe uma campanha ativa: Encomendas. Pause ou encerre essa antes.');
    const clash = await confirm.POST(new Request('http://app.test/x', { method: 'POST' }), ctx);
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toContain('Já existe uma campanha ativa');
    dataMock.error = null;
    expect((await confirm.POST(new Request('http://app.test/x', { method: 'POST' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(404);
    sessionMock.error = new ForbiddenError('sem permissão');
    for (const route of Object.values(routes)) expect((await route.POST(new Request('http://app.test/x', { method: 'POST' }), ctx)).status).toBe(403);
    expect(dataMock.changed).toEqual([]);
  });
});

describe('/api/campaigns/[id]/progress', () => {
  it('pede content.view (criador e leitor leem) e valida o id', async () => {
    const res = await progress.GET(new Request('http://app.test/x'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ progress: { id: ID, published: 4 } });
    expect(sessionMock.calls).toEqual(['content.view']);
    expect((await progress.GET(new Request('http://app.test/x'), { params: Promise.resolve({ id: 'x' }) })).status).toBe(404);
  });
});
