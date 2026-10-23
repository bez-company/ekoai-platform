import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Identidade e banco controlados pelo teste: a rota roda de verdade, o Firebase e o Postgres não.
const identityMock = { result: null, calls: 0 };
// O limite de taxa tem teste próprio (rate-limit.test.js e o de banco): aqui ele sempre deixa passar.
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig()), hit: async () => ({ allowed: true, hits: 1, retryAfterS: 3600 }) }));
vi.mock('@/lib/identity', async (orig) => ({
  // a classe de erro é a de verdade: o que é rotina ou não vem do código, não do dublê
  ...(await orig()),
  verifyIdToken: async () => {
      identityMock.calls += 1;
      if (identityMock.result instanceof Error) throw identityMock.result;
      return identityMock.result;
  },
}));
const accountsMock = { memberships: [], created: [], touched: 0 };
vi.mock('@/lib/accounts', () => ({
  findOrLinkUser: async () => {
    accountsMock.touched += 1;
    return { id: '00000000-0000-4000-8000-00000000000a', sessionVersion: 1, lastTenantId: null };
  },
  membershipsOf: async () => accountsMock.memberships,
  createAccount: async (input) => {
    accountsMock.created.push(input);
    return 'doce-ponto';
  },
  markLogin: async () => {},
}));

const model = await import('../platform/src/lib/account-model.ts');
const { POST } = await import('../platform/src/app/api/account/route.ts');
const { InvalidIdentityError } = await import('@/lib/identity');

const JWT = 'aaa.bbb.ccc';
const now = () => Math.floor(Date.now() / 1000);
const identity = (over = {}) => ({ uid: 'idp-a', email: 'ana@exemplo.test', emailVerified: true, authTime: now(), secondFactor: 'totp', ...over });
const call = (body) => POST(new Request('http://x/api/account', { method: 'POST', body: JSON.stringify(body) }));
const ok = { idToken: JWT, kind: 'empresa', name: 'Doce Ponto Confeitaria' };

beforeEach(() => {
  process.env.AUTH_SECRET = 'segredo-de-teste';
  process.env.AUTH_PROVIDER = 'identity';
  process.env.SIGNUP_MODE = 'open';
  Object.assign(identityMock, { result: identity(), calls: 0 });
  Object.assign(accountsMock, { memberships: [], created: [], touched: 0 });
});
afterEach(() => {
  delete process.env.AUTH_PROVIDER;
  delete process.env.SIGNUP_MODE;
});

describe('modo de cadastro', () => {
  it('só por convite é o padrão e qualquer valor estranho fecha', () => {
    expect(model.signupMode({})).toBe('invite');
    expect(model.signupMode({ SIGNUP_MODE: 'invite' })).toBe('invite');
    expect(model.signupMode({ SIGNUP_MODE: 'OPEN' })).toBe('invite');
    expect(model.signupMode({ SIGNUP_MODE: 'true' })).toBe('invite');
    expect(model.signupMode({ SIGNUP_MODE: 'open' })).toBe('open');
  });
});

describe('identificador da conta', () => {
  it('tira acento, minúsculas e hífen no lugar do resto, dentro do formato da tabela', () => {
    expect(model.slugify('Doce Ponto Confeitaria')).toBe('doce-ponto-confeitaria');
    expect(model.slugify('  Café do Largo!! ')).toBe('cafe-do-largo');
    expect(model.slugify('Ateliê Rocha & Filhos Ltda. de Marília e Região')).toMatch(/^[a-z0-9][a-z0-9-]{1,29}$/);
    expect(model.slugify('😀😀')).toBe('conta');
    expect(model.slugify('a')).toBe('conta');
  });

  it('todo candidato é aceito pela tabela tenants', () => {
    for (const name of ['Doce Ponto', 'Marina Lopes Nutrição', 'X', '---', 'a'.repeat(200)]) {
      for (const id of model.candidateIds(name)) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{1,39}$/);
    }
  });

  it('tenta o nome puro primeiro e depois com sufixo', () => {
    let n = 0;
    const ids = model.candidateIds('Doce Ponto', () => `s${++n}`);
    expect(ids.slice(0, 3)).toEqual(['doce-ponto', 'doce-ponto-s1', 'doce-ponto-s2']);
  });
});

describe('corpo da criação de conta', () => {
  it('aceita empresa e pessoa e limpa o nome', () => {
    expect(model.parseCreateAccount({ ...ok, name: '  Doce   Ponto ' })).toEqual({ ok: true, value: { idToken: JWT, kind: 'empresa', name: 'Doce Ponto' } });
    expect(model.parseCreateAccount({ ...ok, kind: 'pessoa' }).ok).toBe(true);
  });

  it('recusa token torto, tipo desconhecido, nome vazio ou longo, com mensagem útil', () => {
    expect(model.parseCreateAccount({ ...ok, idToken: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/Entre de novo/) });
    expect(model.parseCreateAccount({ ...ok, kind: 'agencia' })).toMatchObject({ ok: false, error: expect.stringMatching(/empresa ou só sua/) });
    expect(model.parseCreateAccount({ ...ok, name: '   ' })).toMatchObject({ ok: false, error: expect.stringMatching(/nome/) });
    expect(model.parseCreateAccount({ ...ok, name: 'a'.repeat(81) })).toMatchObject({ ok: false, error: expect.stringMatching(/80/) });
    expect(model.parseCreateAccount({ ...ok, idToken: 'aaa.bbb.' }).ok).toBe(true); // emulador: sem assinatura
    expect(model.parseCreateAccount({ ...ok, idToken: 'aaa.bbb' }).ok).toBe(false);
    expect(model.parseCreateAccount({ ...ok, idToken: `a.b.${'c'.repeat(9000)}` }).ok).toBe(false);
    expect(model.parseCreateAccount(null).ok).toBe(false);
    expect(model.parseCreateAccount([]).ok).toBe(false);
  });
});

describe('quem pode criar conta', () => {
  it('exige e-mail verificado, login recente e segundo fator', () => {
    expect(model.accountRefusal(identity(), now())).toBeNull();
    expect(model.accountRefusal(identity({ emailVerified: false }), now()).code).toBe('email_not_verified');
    expect(model.accountRefusal(identity({ authTime: now() - 3600 }), now()).code).toBe('login_stale');
    expect(model.accountRefusal(identity({ secondFactor: null }), now()).code).toBe('mfa_required');
  });

  it('com MFA opcional dispensa só o segundo fator, o resto continua exigido', () => {
    expect(model.accountRefusal(identity({ secondFactor: null }), now(), 'optional')).toBeNull();
    expect(model.accountRefusal(identity({ secondFactor: null }), now(), 'required').code).toBe('mfa_required');
    expect(model.accountRefusal(identity({ secondFactor: null, emailVerified: false }), now(), 'optional').code).toBe('email_not_verified');
    expect(model.accountRefusal(identity({ secondFactor: null, authTime: now() - 3600 }), now(), 'optional').code).toBe('login_stale');
  });

  it('limita as contas que uma pessoa administra', () => {
    expect(model.adminAccountLimitRefusal(model.MAX_ADMIN_ACCOUNTS - 1)).toBeNull();
    expect(model.adminAccountLimitRefusal(model.MAX_ADMIN_ACCOUNTS).code).toBe('account_limit');
  });

  it('cada tipo usa o plano do próprio tipo', () => {
    expect(model.PLAN_BY_KIND).toEqual({ empresa: 'inicial', pessoa: 'pessoa' });
  });
});

describe('POST /api/account', () => {
  it('responde 404 sem tocar em nada fora do modo aberto ou sem login por pessoa', async () => {
    process.env.SIGNUP_MODE = 'invite';
    expect((await call(ok)).status).toBe(404);
    process.env.SIGNUP_MODE = 'open';
    process.env.AUTH_PROVIDER = 'password';
    expect((await call(ok)).status).toBe(404);
    expect(identityMock.calls).toBe(0);
    expect(accountsMock.touched).toBe(0);
  });

  it('corpo inválido: 400 antes de conferir o token', async () => {
    const res = await call({ ...ok, kind: 'x' });
    expect(res.status).toBe(400);
    expect(identityMock.calls).toBe(0);
  });

  it('token inválido: 401 sem detalhe e sem tocar no banco', async () => {
    identityMock.result = new InvalidIdentityError('assinatura ruim');
    const res = await call(ok);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_token');
    expect(accountsMock.touched).toBe(0);
  });

  it('com MFA_MODE=optional, sem segundo fator a conta é criada', async () => {
    process.env.MFA_MODE = 'optional';
    try {
      identityMock.result = identity({ secondFactor: null });
      const res = await call(ok);
      expect(res.status).toBe(201);
      expect(accountsMock.created.length).toBe(1);
    } finally {
      delete process.env.MFA_MODE;
    }
  });

  it('sem segundo fator: 403 e nada é criado, nem a pessoa', async () => {
    identityMock.result = identity({ secondFactor: null });
    const res = await call(ok);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('mfa_required');
    expect(accountsMock.touched).toBe(0);
    expect(accountsMock.created).toEqual([]);
  });

  it('e-mail não verificado: 403', async () => {
    identityMock.result = identity({ emailVerified: false });
    expect((await call(ok)).status).toBe(403);
    expect(accountsMock.created).toEqual([]);
  });

  it('quem já administra o máximo de contas: 403', async () => {
    accountsMock.memberships = Array.from({ length: model.MAX_ADMIN_ACCOUNTS }, (_, i) => ({ tenantId: `c${i}`, role: 'admin', createdAt: '' }));
    const res = await call(ok);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('account_limit');
    expect(accountsMock.created).toEqual([]);
  });

  it('criador e leitor de outras contas não contam para o limite', async () => {
    accountsMock.memberships = Array.from({ length: 9 }, (_, i) => ({ tenantId: `c${i}`, role: i % 2 ? 'creator' : 'viewer', createdAt: '' }));
    expect((await call(ok)).status).toBe(201);
  });

  it('cria a conta, devolve a conta nova e abre a sessão', async () => {
    const res = await call({ ...ok, kind: 'pessoa', name: 'Marina Lopes' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, tenantId: 'doce-ponto', role: 'admin' });
    expect(accountsMock.created).toEqual([{ userId: '00000000-0000-4000-8000-00000000000a', name: 'Marina Lopes', kind: 'pessoa' }]);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/^pa_session=u\.00000000-0000-4000-8000-00000000000a\.doce-ponto\.1\./);
    expect(cookie).toMatch(/HttpOnly/i);
  });
});
