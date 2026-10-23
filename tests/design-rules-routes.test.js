// As rotas da regra de marca do design (SPEC 019, BEZ-270): só quem gere a marca decide (403 para criador e
// leitor), id e ação são validados antes de qualquer I/O, e conflito de estado vira 409.
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
vi.mock('@/lib/design-rules', () => {
  const view = (status) => ({ id: 'r', field: 'logoCorner', scope: 'any', value: 'br', status, title: 'Logo no canto inferior direito' });
  const run = (name, status) => async (...args) => {
    dataMock.calls.push([name, ...args.slice(1)]);
    if (dataMock.error) throw dataMock.error;
    return name === 'activate' ? { rule: view(status), turnedOff: ['Logo no canto superior direito'] } : view(status);
  };
  return {
    listRules: async () => [view('proposed')],
    activateRule: run('activate', 'active'),
    dismissRule: run('dismiss', 'dismissed'),
    disableRule: run('disable', 'off'),
    undoRule: run('undo', 'proposed'),
  };
});

const { GET: LIST } = await import('../platform/src/app/api/design-rules/route.ts');
const { POST: ACT } = await import('../platform/src/app/api/design-rules/[id]/[action]/route.ts');
const { ForbiddenError } = await import('@/lib/session');
const { ConflictError } = await import('@/lib/errors');

const ID = '11111111-2222-4333-8444-555555555555';
const act = (action, id = ID) => ACT(new Request('http://app.test', { method: 'POST' }), { params: Promise.resolve({ id, action }) });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [], user: { id: 'u-1' } });
  Object.assign(dataMock, { calls: [], error: null });
});

describe('regras do design', () => {
  it('listar pede profile.view', async () => {
    const res = await LIST();
    expect(res.status).toBe(200);
    expect((await res.json()).rules[0]).toMatchObject({ id: 'r', title: 'Logo no canto inferior direito' });
    expect(sessionMock.calls).toEqual(['profile.view']);
  });

  it('aceitar e ligar de novo ativam e dizem qual regra desligou; a pessoa vai junto', async () => {
    const res = await act('accept');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rule: { status: 'active' }, turnedOff: ['Logo no canto superior direito'] });
    expect(dataMock.calls[0]).toEqual(['activate', ID, 'u-1', 'proposed']);
    await act('enable');
    expect(dataMock.calls[1]).toEqual(['activate', ID, 'u-1', 'off']);
    expect(sessionMock.calls).toEqual(['brand.manage', 'brand.manage']);
  });

  it('dispensar, desligar e desfazer chamam a ação certa', async () => {
    expect((await (await act('dismiss')).json()).rule.status).toBe('dismissed');
    expect((await (await act('disable')).json()).rule.status).toBe('off');
    expect((await (await act('undo')).json()).rule.status).toBe('proposed');
    expect(dataMock.calls.map((c) => c[0])).toEqual(['dismiss', 'disable', 'undo']);
  });

  it('login de senha única decide sem pessoa', async () => {
    sessionMock.user = null;
    await act('accept');
    expect(dataMock.calls[0]).toEqual(['activate', ID, null, 'proposed']);
  });

  it('criador e leitor recebem 403 e nada é chamado', async () => {
    sessionMock.error = new ForbiddenError();
    for (const a of ['accept', 'dismiss', 'disable', 'enable', 'undo']) expect((await act(a)).status).toBe(403);
    expect(dataMock.calls).toEqual([]);
  });

  it('id inválido ou ação desconhecida: 404 antes de qualquer I/O', async () => {
    expect((await act('accept', 'x')).status).toBe(404);
    expect((await act('delete')).status).toBe(404);
    expect(dataMock.calls).toEqual([]);
  });

  it('estado que mudou vira 409 com a mensagem', async () => {
    dataMock.error = new ConflictError('A regra mudou enquanto você olhava. Recarregue a página.');
    const res = await act('accept');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A regra mudou enquanto você olhava. Recarregue a página.' });
  });
});
