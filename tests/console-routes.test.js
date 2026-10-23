import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Portão, contas e e-mail simulados: aqui só a ligação das rotas do console (404 do portão, 400 com o
// próximo passo, o que grava e com quem). As regras do banco têm teste em tests/db/console.integration.test.js
// e o portão em tests/platform-gate.test.js.
const gate = { error: null, calls: 0 };
const ADMIN = { id: 'u-dono', name: 'Dono', sessionVersion: 1, lastTenantId: null };
vi.mock('@/lib/platform-admin', () => {
  class ConsoleDeniedError extends Error {}
  return {
    ConsoleDeniedError,
    requirePlatformAdmin: async () => {
      gate.calls += 1;
      if (gate.error) throw gate.error;
      return { user: ADMIN, email: 'dono@exemplo.test' };
    },
  };
});
const data = { created: [], suspended: [], reactivated: [], error: null };
vi.mock('@/lib/console-accounts', () => ({
  createAccountWithInvite: async (input, actor) => {
    if (data.error) throw data.error;
    data.created.push([input, actor]);
    return { id: 'doce-ponto', token: 'T'.repeat(43), expiresAt: '2026-10-30T12:00:00.000Z' };
  },
  suspendAccount: async (id, actor, reason) => {
    if (data.error) throw data.error;
    data.suspended.push([id, actor, reason]);
  },
  reactivateAccount: async (id, actor) => {
    if (data.error) throw data.error;
    data.reactivated.push([id, actor]);
  },
}));
const mail = { sent: [], on: false };
vi.mock('@/lib/mailer', () => ({
  getMailer: () => (mail.on ? { sendInvitation: async (m) => void mail.sent.push(m) } : null),
}));
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return { UnauthorizedError, ForbiddenError };
});

const { POST: create } = await import('../platform/src/app/api/console/accounts/route.ts');
const { POST: suspend } = await import('../platform/src/app/api/console/accounts/[id]/suspend/route.ts');
const { POST: reactivate } = await import('../platform/src/app/api/console/accounts/[id]/reactivate/route.ts');
const { ConsoleDeniedError } = await import('@/lib/platform-admin');
const { UnauthorizedError } = await import('@/lib/session');
const { ConflictError, NotFoundError } = await import('@/lib/errors');

const req = (body) => new Request('http://app.test/api/console/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const params = (id) => ({ params: Promise.resolve({ id }) });
const NEW = { name: 'Doce Ponto', kind: 'empresa', email: 'ana@doceponto.com.br' };

beforeEach(() => {
  process.env.APP_BASE_URL = 'https://app.exemplo.com.br';
  Object.assign(gate, { error: null, calls: 0 });
  Object.assign(data, { created: [], suspended: [], reactivated: [], error: null });
  Object.assign(mail, { sent: [], on: false });
});
afterEach(() => {
  delete process.env.APP_BASE_URL;
});

describe('o portão vale para toda rota do console', () => {
  it('quem não passa recebe 404 seco e nada é gravado', async () => {
    gate.error = new ConsoleDeniedError('x');
    for (const call of [() => create(req(NEW)), () => suspend(req({ reason: 'Pagamento atrasado' }), params('doce-ponto')), () => reactivate(req({}), params('doce-ponto'))]) {
      const res = await call();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Não encontrado' });
    }
    expect(data.created).toEqual([]);
    expect(data.suspended).toEqual([]);
    expect(data.reactivated).toEqual([]);
  });

  it('sessão vencida volta 401', async () => {
    gate.error = new UnauthorizedError();
    expect((await create(req(NEW))).status).toBe(401);
  });
});

describe('POST /api/console/accounts', () => {
  it('cria a conta com quem é a administradora e, sem e-mail configurado, devolve o link do convite', async () => {
    const res = await create(req(NEW));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'doce-ponto', sent: false, link: `https://app.exemplo.com.br/convite/${'T'.repeat(43)}`, expiresAt: '2026-10-30T12:00:00.000Z' });
    expect(data.created).toEqual([[{ name: 'Doce Ponto', kind: 'empresa', email: 'ana@doceponto.com.br' }, 'u-dono']]);
  });

  it('com provedor de e-mail, manda o convite e não devolve o link', async () => {
    mail.on = true;
    const body = await (await create(req(NEW))).json();
    expect(body).toEqual({ id: 'doce-ponto', sent: true, expiresAt: '2026-10-30T12:00:00.000Z' });
    expect(mail.sent).toEqual([expect.objectContaining({ to: 'ana@doceponto.com.br', accountName: 'Doce Ponto', role: 'admin' })]);
  });

  it('corpo inválido volta 400 com o próximo passo e não cria', async () => {
    for (const body of [{ ...NEW, email: 'x' }, { ...NEW, name: '' }, { ...NEW, kind: 'x' }, '{quebrado']) {
      const res = await create(req(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(data.created).toEqual([]);
  });
});

describe('POST /api/console/accounts/[id]/suspend', () => {
  it('suspende com o motivo limpo e quem fez', async () => {
    const res = await suspend(req({ reason: '  Pagamento   em atraso ' }), params('doce-ponto'));
    expect(res.status).toBe(200);
    expect(data.suspended).toEqual([['doce-ponto', 'u-dono', 'Pagamento em atraso']]);
  });

  it('sem motivo, 400; id fora do formato, 400; já suspensa, 400 com a mensagem do conflito', async () => {
    expect((await suspend(req({ reason: '' }), params('doce-ponto'))).status).toBe(400);
    expect((await suspend(req({ reason: 'Pagamento atrasado' }), params("x'; drop"))).status).toBe(400);
    data.error = new ConflictError('Essa conta já está suspensa.');
    const res = await suspend(req({ reason: 'Pagamento atrasado' }), params('doce-ponto'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Essa conta já está suspensa.');
    expect(data.suspended).toEqual([]);
  });
});

describe('POST /api/console/accounts/[id]/reactivate', () => {
  it('reativa, e conta inexistente volta 404 com a mensagem', async () => {
    expect((await reactivate(req({}), params('doce-ponto'))).status).toBe(200);
    expect(data.reactivated).toEqual([['doce-ponto', 'u-dono']]);
    data.error = new NotFoundError('Essa conta não existe mais. Volte para a lista.');
    const res = await reactivate(req({}), params('fantasma'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/não existe mais/);
  });
});
