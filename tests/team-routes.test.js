import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Identidade, banco, sessão e equipe simulados: aqui só a ligação das rotas (o que cada uma
// recusa, em que ordem, o que devolve). As regras de banco têm teste próprio em tests/db.
const identityMock = { result: null, calls: 0 };
vi.mock('@/lib/identity', async (orig) => ({
  // a classe de erro é a de verdade: o que é rotina ou não vem do código, não do dublê
  ...(await orig()),
  verifyIdToken: async () => {
      identityMock.calls += 1;
      if (identityMock.result instanceof Error) throw identityMock.result;
      return identityMock.result;
  },
}));
const USER = '00000000-0000-4000-8000-00000000000a';
const accountsMock = { memberships: [], acceptError: null, accepted: [], touched: 0 };
vi.mock('@/lib/accounts', () => ({
  findOrLinkUser: async () => {
    accountsMock.touched += 1;
    return { id: USER, sessionVersion: 1, lastTenantId: null, name: 'Ana Ribeiro' };
  },
  membershipsOf: async () => accountsMock.memberships,
  acceptInvitation: async (userId, hash) => {
    if (accountsMock.acceptError) throw accountsMock.acceptError;
    accountsMock.accepted.push({ userId, hash });
    return 'acme';
  },
  markLogin: async () => {},
  accountOf: async () => ({ id: 'acme', name: 'Acme', kind: 'empresa', plan: {} }),
}));
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
      return { t: { tenantId: 'acme' }, user: { id: USER, name: 'Ana Ribeiro', sessionVersion: 1, lastTenantId: null } };
    },
  };
});
const teamMock = { created: [], resent: [], cancelled: [], roles: [], removed: [] };
vi.mock('@/lib/team', () => ({
  createInvitation: async (_t, _u, input) => (teamMock.created.push(input), { id: 'id-1', token: 'T'.repeat(43) }),
  resendInvitation: async (_t, _u, id) => (teamMock.resent.push(id), { id, email: 'c@x.com', role: 'viewer', token: 'R'.repeat(43) }),
  cancelInvitation: async (_t, _u, id) => void teamMock.cancelled.push(id),
  changeRole: async (_t, _u, id, role) => void teamMock.roles.push([id, role]),
  removeMember: async (_t, _u, id) => void teamMock.removed.push(id),
}));

const { POST: accept } = await import('../platform/src/app/api/invitations/accept/route.ts');
const { POST: invite } = await import('../platform/src/app/api/team/invitations/route.ts');
const { POST: resend } = await import('../platform/src/app/api/team/invitations/[id]/resend/route.ts');
const { DELETE: cancel } = await import('../platform/src/app/api/team/invitations/[id]/route.ts');
const { PATCH: patchMember, DELETE: removeMember } = await import('../platform/src/app/api/team/members/[userId]/route.ts');
const { InvalidIdentityError } = await import('@/lib/identity');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');

const JWT = 'aaa.bbb.ccc';
const TOKEN = 'A'.repeat(43);
const now = () => Math.floor(Date.now() / 1000);
const identity = (over = {}) => ({ uid: 'idp-a', email: 'ana@exemplo.test', emailVerified: true, authTime: now(), secondFactor: null, name: 'Ana', ...over });
const post = (route, body, params) => route(new Request('http://app.test/x', { method: 'POST', body: JSON.stringify(body) }), params && { params: Promise.resolve(params) });
const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

beforeEach(() => {
  process.env.AUTH_SECRET = 'segredo-de-teste';
  process.env.AUTH_PROVIDER = 'identity';
  process.env.APP_BASE_URL = 'https://app.exemplo.com.br';
  Object.assign(identityMock, { result: identity(), calls: 0 });
  Object.assign(accountsMock, { memberships: [{ tenantId: 'acme', role: 'creator', createdAt: '' }], acceptError: null, accepted: [], touched: 0 });
  Object.assign(sessionMock, { error: null, calls: [] });
  for (const k of Object.keys(teamMock)) teamMock[k] = [];
});
afterEach(() => {
  delete process.env.AUTH_PROVIDER;
  delete process.env.APP_BASE_URL;
  delete process.env.MAIL_PROVIDER;
});

describe('POST /api/invitations/accept', () => {
  const call = (body = { idToken: JWT, token: TOKEN }) => post(accept, body);

  it('404 sem login por pessoa; 400 com corpo ruim, sem conferir o token', async () => {
    process.env.AUTH_PROVIDER = 'password';
    expect((await call()).status).toBe(404);
    process.env.AUTH_PROVIDER = 'identity';
    expect((await call({ idToken: JWT, token: 'curto' })).status).toBe(400);
    expect(identityMock.calls).toBe(0);
  });

  it('token de login inválido: 401; e-mail não verificado: 403; nada toca no banco', async () => {
    identityMock.result = new InvalidIdentityError('ruim');
    expect((await call()).status).toBe(401);
    identityMock.result = identity({ emailVerified: false });
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('email_not_verified');
    expect(accountsMock.touched).toBe(0);
  });

  it('cada falha do convite vira o estado certo da tela', async () => {
    const expected = {
      invitation_not_found: [404, 'invite_not_found'],
      invitation_cancelled: [410, 'invite_cancelled'],
      invitation_used: [410, 'invite_used'],
      invitation_expired: [410, 'invite_expired'],
      invitation_email_mismatch: [403, 'invite_email_mismatch'],
      already_member: [409, 'already_member'],
    };
    for (const [message, [status, code]] of Object.entries(expected)) {
      accountsMock.acceptError = new Error(message);
      const res = await call();
      expect([res.status, (await res.json()).code]).toEqual([status, code]);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('erro técnico do banco: 500 neutro, sem vazar a causa', async () => {
    accountsMock.acceptError = new Error('connection terminated: senha=abc');
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('senha');
  });

  it('entrou como criador: abre a sessão na conta do convite', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, accepted: true, tenantId: 'acme', role: 'creator' });
    expect(res.headers.get('set-cookie')).toMatch(/^pa_session=u\.00000000-0000-4000-8000-00000000000a\.acme\.1\./);
    expect(accountsMock.accepted[0].userId).toBe(USER);
    expect(accountsMock.accepted[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(accountsMock.accepted[0].hash).not.toContain(TOKEN);
  });

  it('administrador sem segundo fator: aceita, mas não abre sessão (202)', async () => {
    accountsMock.memberships = [{ tenantId: 'acme', role: 'admin', createdAt: '' }];
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, tenantId: 'acme', role: 'admin', code: 'mfa_required' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('token recusado: o motivo técnico fica no log', () => {
  const logged = async (route, body, error) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    identityMock.result = error;
    const res = await post(route, body);
    const out = { status: res.status, body: await res.json(), warn: warn.mock.calls.flat().join('\n'), error: err.mock.calls.flat().join('\n') };
    warn.mockRestore();
    err.mockRestore();
    return out;
  };

  it('vencido é rotina: aviso com o motivo, e a pessoa vê só a mensagem de sempre', async () => {
    const out = await logged(accept, { idToken: JWT, token: TOKEN }, new InvalidIdentityError('Firebase ID token has expired.', 'auth/id-token-expired'));
    expect(out.status).toBe(401);
    expect(out.body).toEqual({ error: 'Não deu para confirmar o login. Entre de novo.', code: 'invalid_token' });
    expect(out.warn).toContain('Firebase ID token has expired.');
    expect(out.warn).toContain('api/invitations/accept');
    expect(out.error).toBe('');
  });

  it('permissão da conta de serviço, rede ou projeto errado: erro (e Sentry), nunca silêncio', async () => {
    const out = await logged(accept, { idToken: JWT, token: TOKEN }, new InvalidIdentityError('PERMISSION_DENIED: caller does not have permission', 'auth/insufficient-permission'));
    expect(out.status).toBe(401);
    expect(out.error).toContain('PERMISSION_DENIED');
    expect(out.error).toContain('auth/insufficient-permission');
    expect(out.warn).toBe('');
    expect(out.body.error).not.toContain('PERMISSION');
  });

  it('o mesmo vale para criar conta', async () => {
    const { POST: account } = await import('../platform/src/app/api/account/route.ts');
    process.env.SIGNUP_MODE = 'open';
    const out = await logged(account, { idToken: JWT, kind: 'empresa', name: 'Doce Ponto' }, new InvalidIdentityError('rede caiu', 'auth/network-error'));
    delete process.env.SIGNUP_MODE;
    expect(out.status).toBe(401);
    expect(out.error).toContain('rede caiu');
  });

  it('e para a rota de sessão do login', async () => {
    const { POST: session } = await import('../platform/src/app/api/auth/session/route.ts');
    const out = await logged(session, { idToken: JWT }, new InvalidIdentityError('Firebase ID token has been revoked.', 'auth/id-token-revoked'));
    expect(out.status).toBe(401);
    expect(out.body.code).toBe('invalid_token');
    expect(out.warn).toContain('has been revoked');
    expect(out.warn).toContain('api/auth/session');
  });
});

describe('rotas de equipe', () => {
  it('toda ação exige team.manage', async () => {
    await post(invite, { email: 'c@x.com', role: 'viewer' });
    await post(resend, {}, { id: ID });
    await cancel(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: ID }) });
    await patchMember(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) }), { params: Promise.resolve({ userId: ID }) });
    await removeMember(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ userId: ID }) });
    expect(sessionMock.calls).toEqual(Array(5).fill('team.manage'));
  });

  it('sem permissão: 403 e nada acontece; sessão vencida: 401', async () => {
    sessionMock.error = new ForbiddenError('sem permissão');
    expect((await post(invite, { email: 'c@x.com', role: 'viewer' })).status).toBe(403);
    expect((await removeMember(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ userId: ID }) })).status).toBe(403);
    sessionMock.error = new UnauthorizedError('venceu');
    expect((await post(invite, { email: 'c@x.com', role: 'viewer' })).status).toBe(401);
    expect(teamMock.created).toEqual([]);
    expect(teamMock.removed).toEqual([]);
  });

  it('convidar: devolve o link para copiar enquanto não há provedor de e-mail', async () => {
    const res = await post(invite, { email: 'Carla@X.com', role: 'viewer' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'id-1', sent: false, link: `https://app.exemplo.com.br/convite/${'T'.repeat(43)}` });
    expect(teamMock.created).toEqual([{ email: 'carla@x.com', role: 'viewer' }]);
  });

  it('convidar com corpo ruim: 400 sem criar nada', async () => {
    for (const body of [{ email: 'x', role: 'viewer' }, { email: 'c@x.com', role: 'dono' }, null]) {
      expect((await post(invite, body)).status).toBe(400);
    }
    expect(teamMock.created).toEqual([]);
  });

  it('provedor de e-mail configurado e sem implementação: falha antes de criar o convite', async () => {
    process.env.MAIL_PROVIDER = 'resend';
    expect((await post(invite, { email: 'c@x.com', role: 'viewer' })).status).toBe(500);
    expect((await post(resend, {}, { id: ID })).status).toBe(500);
    expect(teamMock.created).toEqual([]);
    expect(teamMock.resent).toEqual([]);
  });

  it('reenviar devolve o link novo; id fora do formato: 400', async () => {
    const res = await post(resend, {}, { id: ID });
    expect(await res.json()).toEqual({ id: ID, sent: false, link: `https://app.exemplo.com.br/convite/${'R'.repeat(43)}` });
    expect((await post(resend, {}, { id: 'nao-e-uuid' })).status).toBe(400);
    expect(teamMock.resent).toEqual([ID]);
  });

  it('cancelar, mudar papel e remover chamam a equipe com o id certo', async () => {
    expect((await cancel(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: ID }) })).status).toBe(200);
    expect((await patchMember(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ role: 'creator' }) }), { params: Promise.resolve({ userId: ID }) })).status).toBe(200);
    expect((await patchMember(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ role: 'rei' }) }), { params: Promise.resolve({ userId: ID }) })).status).toBe(400);
    expect((await removeMember(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ userId: ID }) })).status).toBe(200);
    expect(teamMock).toMatchObject({ cancelled: [ID], roles: [[ID, 'creator']], removed: [ID] });
  });
});
