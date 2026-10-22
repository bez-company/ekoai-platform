import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sessão e coordenador simulados: só a ligação das rotas (permissão, id, status da resposta). O banco
// e as regras têm teste em tests/db/content-coordinator.integration.test.js e tests/content-plan-model.test.js.
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
    requireUserPermission: async (permission) => (await gate(permission), { t: { tenantId: 'acme' }, user: { id: 'u1' } }),
  };
});
const lib = { created: { kind: 'generate', briefId: 'b1' }, calls: [], skipError: null };
vi.mock('@/lib/content-coordinator', () => ({
  listSuggestions: async () => [{ id: 's1' }],
  createFromSuggestion: async (_t, _u, id) => (lib.calls.push(['create', id]), lib.created),
  replaceSuggestion: async (_t, _u, id) => (lib.calls.push(['replace', id]), { id: 's2' }),
  skipSuggestion: async (_t, _u, id) => {
    if (lib.skipError) throw lib.skipError;
    lib.calls.push(['skip', id]);
  },
}));
const cron = { authorized: true, asleep: false, ran: 0 };
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: async () => cron.authorized }));
vi.mock('@/lib/wake-gate', () => ({ environmentAsleep: async () => cron.asleep }));

const list = await import('../platform/src/app/api/suggestions/route.ts');
const create = await import('../platform/src/app/api/suggestions/[id]/create/route.ts');
const replace = await import('../platform/src/app/api/suggestions/[id]/replace/route.ts');
const skip = await import('../platform/src/app/api/suggestions/[id]/skip/route.ts');
const { UserError } = await import('@/lib/errors');

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = () => new Request('http://x', { method: 'POST' });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(lib, { created: { kind: 'generate', briefId: 'b1' }, calls: [], skipError: null });
  Object.assign(cron, { authorized: true, asleep: false });
});

describe('/api/suggestions', () => {
  it('lista com content.view', async () => {
    const res = await list.GET();
    expect(await res.json()).toEqual({ suggestions: [{ id: 's1' }] });
    expect(sessionMock.calls).toEqual(['content.view']);
  });

  it('Criar este post: 201 com o pedido; com foto, 200 com a foto para o Publicar foto', async () => {
    const res = await create.POST(req(), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ kind: 'generate', briefId: 'b1' });
    lib.created = { kind: 'photo', assetId: 'a1', idea: 'x' };
    expect((await create.POST(req(), ctx())).status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.create', 'content.create']);
  });

  it('Trocar e Pular pedem content.create; id fora do formato é 404', async () => {
    expect(await (await replace.POST(req(), ctx())).json()).toEqual({ suggestion: { id: 's2' } });
    expect((await skip.POST(req(), ctx())).status).toBe(200);
    expect((await skip.POST(req(), ctx('x'))).status).toBe(404);
    expect(lib.calls).toEqual([['replace', ID], ['skip', ID]]);
  });

  it('sugestão já decidida volta 400 com a mensagem', async () => {
    lib.skipError = new UserError('Esta sugestão já foi usada, trocada ou pulada. Recarregue a página.');
    const res = await skip.POST(req(), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Recarregue/);
  });
});

describe('/api/cron/plan-content', () => {
  it('sem credencial é 401; com o banco do staging dormindo, não planeja', async () => {
    const route = await import('../platform/src/app/api/cron/plan-content/route.ts');
    cron.authorized = false;
    expect((await route.POST(req())).status).toBe(401);
    cron.authorized = true;
    cron.asleep = true;
    expect(await (await route.POST(req())).json()).toEqual({ ok: true, skipped: 'asleep' });
  });
});
