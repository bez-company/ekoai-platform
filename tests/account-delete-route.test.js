import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sessão, identidade e exclusão simuladas: aqui só a ligação da rota (as provas pedidas, em que
// ordem, o que ela faz depois). A cascata de verdade tem teste em tests/db/account-deletion.integration.test.js.
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
      return { t: { tenantId: 'acme' }, user: { id: 'user-1', name: 'Ana Ribeiro' } };
    },
  };
});
const accountsMock = { account: { id: 'acme', name: 'Doce Ponto Confeitaria', kind: 'empresa' }, idp: 'idp-a' };
vi.mock('@/lib/accounts', () => ({ accountOf: async () => accountsMock.account, idpUidOf: async () => accountsMock.idp }));
const identityMock = { result: null, calls: 0 };
vi.mock('@/lib/identity', async (orig) => ({
  ...(await orig()),
  verifyIdToken: async () => {
    identityMock.calls += 1;
    if (identityMock.result instanceof Error) throw identityMock.result;
    return identityMock.result;
  },
}));
const deleteMock = { calls: [], error: null, result: { adminEmails: ['carla@x.test', 'diego@x.test'], members: 3 } };
vi.mock('@/lib/account-deletion', () => ({
  deleteAccount: async (input) => {
    if (deleteMock.error) throw deleteMock.error;
    deleteMock.calls.push(input);
    return deleteMock.result;
  },
}));
const mailMock = { mailer: null, getError: null, sent: [], failFor: null };
vi.mock('@/lib/mailer', () => ({
  getMailer: () => {
    if (mailMock.getError) throw mailMock.getError;
    return mailMock.mailer;
  },
}));

const { POST } = await import('../platform/src/app/api/account/delete/route.ts');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');
const { InvalidIdentityError } = await import('@/lib/identity');

const now = () => Math.floor(Date.now() / 1000);
const identity = (over = {}) => ({ uid: 'idp-a', email: 'ana@x.test', emailVerified: true, authTime: now() - 20, secondFactor: 'totp', name: 'Ana', ...over });
const post = (body) => POST(new Request('http://app.test/api/account/delete', { method: 'POST', body: JSON.stringify(body) }));
const GOOD = { confirmName: 'Doce Ponto Confeitaria', idToken: 'aaa.bbb.ccc' };

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(accountsMock, { account: { id: 'acme', name: 'Doce Ponto Confeitaria', kind: 'empresa' }, idp: 'idp-a' });
  Object.assign(identityMock, { result: identity(), calls: 0 });
  Object.assign(deleteMock, { calls: [], error: null });
  mailMock.sent = [];
  mailMock.getError = null;
  mailMock.mailer = { sendAccountDeleted: async (mail) => (mailMock.failFor === mail.to ? Promise.reject(new Error('smtp')) : void mailMock.sent.push(mail)) };
  mailMock.failFor = null;
});

describe('POST /api/account/delete', () => {
  it('pede account.delete; sem sessão 401, sem permissão 403, e nada é conferido nem apagado', async () => {
    sessionMock.error = new UnauthorizedError();
    expect((await post(GOOD)).status).toBe(401);
    sessionMock.error = new ForbiddenError();
    expect((await post(GOOD)).status).toBe(403);
    expect(sessionMock.calls).toEqual(['account.delete', 'account.delete']);
    expect(identityMock.calls).toBe(0);
    expect(deleteMock.calls).toEqual([]);
  });

  it('corpo ruim: 400 sem tocar na identidade', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ confirmName: 'x' })).status).toBe(400);
    expect(identityMock.calls).toBe(0);
  });

  it('nome errado: 400 antes de conferir o token, nada apagado', async () => {
    const res = await post({ ...GOOD, confirmName: 'Doce Ponto' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não é o da conta/);
    expect(identityMock.calls).toBe(0);
    expect(deleteMock.calls).toEqual([]);
  });

  it('ID token inválido: 401 neutro com code invalid_token', async () => {
    identityMock.result = new InvalidIdentityError('assinatura ruim', 'auth/argument-error');
    const res = await post(GOOD);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_token');
    expect(deleteMock.calls).toEqual([]);
  });

  it('cada reautenticação fraca é recusada com o motivo e nada é apagado', async () => {
    const cases = [
      [{ uid: 'idp-b' }, 403, 'wrong_person'],
      [{ emailVerified: false }, 403, 'email_not_verified'],
      [{ secondFactor: null }, 403, 'no_second_factor'],
      [{ authTime: now() - 3600 }, 401, 'stale'],
    ];
    for (const [over, status, code] of cases) {
      identityMock.result = identity(over);
      const res = await post(GOOD);
      expect([res.status, (await res.json()).code], code).toEqual([status, code]);
    }
    expect(deleteMock.calls).toEqual([]);
  });

  it('a sessão sem idp_uid (login de senha única) não consegue excluir', async () => {
    accountsMock.idp = null;
    expect((await post(GOOD)).status).toBe(403);
    expect(deleteMock.calls).toEqual([]);
  });

  it('tudo certo: apaga a conta da sessão, avisa os outros administradores e encerra a sessão', async () => {
    const res = await post({ ...GOOD, confirmName: '  Doce  Ponto Confeitaria ', tenantId: 'outra' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteMock.calls).toEqual([{ tenantId: 'acme', actorUserId: 'user-1', kind: 'empresa' }]);
    expect(mailMock.sent.map((m) => m.to).sort()).toEqual(['carla@x.test', 'diego@x.test']);
    expect(mailMock.sent[0]).toMatchObject({ accountName: 'Doce Ponto Confeitaria', deletedByName: 'Ana Ribeiro' });
    expect(res.headers.get('set-cookie')).toMatch(/pa_session=;.*Max-Age=0/i);
  });

  it('o aviso é melhor esforço: falha de um e-mail, ou provedor mal configurado, não desfaz a exclusão', async () => {
    mailMock.failFor = 'carla@x.test';
    expect((await post(GOOD)).status).toBe(200);
    expect(mailMock.sent.map((m) => m.to)).toEqual(['diego@x.test']);
    mailMock.getError = new Error('MAIL_PROVIDER sem implementação');
    expect((await post(GOOD)).status).toBe(200);
  });

  it('sem provedor de e-mail (hoje): exclui e não avisa', async () => {
    mailMock.mailer = null;
    expect((await post(GOOD)).status).toBe(200);
    expect(mailMock.sent).toEqual([]);
  });

  it('erro técnico na exclusão: 500 neutro, sem vazar a causa, sessão mantida', async () => {
    deleteMock.error = new Error('connection terminated: senha=abc');
    const res = await post(GOOD);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('senha');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
