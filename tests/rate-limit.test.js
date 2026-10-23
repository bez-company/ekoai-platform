import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Limite de taxa nas rotas públicas de entrada (BEZ-29). O modelo é puro; nas rotas, o contador é
// dublê (o de verdade tem teste de banco), a identidade e as contas também, como em account.test.js.
const rate = { blocked: new Set(), calls: [] };
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig()),
  hit: async (rule, key) => {
    rate.calls.push([rule.bucket, key]);
    return rate.blocked.has(rule.bucket) ? { allowed: false, hits: rule.limit + 1, retryAfterS: 1500 } : { allowed: true, hits: 1, retryAfterS: 3600 };
  },
}));
const identityMock = { calls: 0 };
vi.mock('@/lib/identity', async (orig) => ({
  ...(await orig()),
  verifyIdToken: async () => {
    identityMock.calls += 1;
    return { uid: 'idp-a', email: 'ana@exemplo.test', emailVerified: true, authTime: Math.floor(Date.now() / 1000), secondFactor: 'totp' };
  },
}));
const created = [];
vi.mock('@/lib/accounts', () => ({
  findOrLinkUser: async () => ({ id: '00000000-0000-4000-8000-00000000000a', sessionVersion: 1, lastTenantId: null }),
  membershipsOf: async () => [],
  createAccount: async (input) => {
    created.push(input);
    return 'doce-ponto';
  },
  acceptInvitation: async () => {
    throw new Error('não deveria chegar aqui');
  },
  markLogin: async () => {},
}));

const model = await import('../platform/src/lib/rate-limit-model.ts');
const account = await import('../platform/src/app/api/account/route.ts');
const accept = await import('../platform/src/app/api/invitations/accept/route.ts');

const post = (handler, path, body, ip = '203.0.113.7') =>
  handler.POST(new Request(`http://x${path}`, { method: 'POST', headers: { 'x-forwarded-for': `1.2.3.4, ${ip}` }, body: JSON.stringify(body) }));

beforeEach(() => {
  process.env.AUTH_SECRET = 'segredo-de-teste';
  process.env.AUTH_PROVIDER = 'identity';
  process.env.SIGNUP_MODE = 'open';
  rate.blocked.clear();
  rate.calls.length = 0;
  identityMock.calls = 0;
  created.length = 0;
});
afterEach(() => {
  delete process.env.AUTH_PROVIDER;
  delete process.env.SIGNUP_MODE;
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe('IP de quem chama', () => {
  it('é o último do X-Forwarded-For, que o Google acrescenta; o começo pode ser forjado', () => {
    expect(model.clientIp('6.6.6.6, 203.0.113.7')).toBe('203.0.113.7');
    expect(model.clientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(model.clientIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('com proxy nosso na frente, pula os saltos confiáveis', () => {
    expect(model.clientIp('6.6.6.6, 203.0.113.7, 10.0.0.1', 1)).toBe('203.0.113.7');
    expect(model.trustedHopsFrom({ TRUSTED_PROXY_HOPS: '1' })).toBe(1);
    expect(model.trustedHopsFrom({ TRUSTED_PROXY_HOPS: 'x' })).toBe(0);
    expect(model.trustedHopsFrom({})).toBe(0);
  });

  it('sem cabeçalho ou com valor estranho, não há IP', () => {
    expect(model.clientIp(null)).toBeNull();
    expect(model.clientIp('')).toBeNull();
    expect(model.clientIp('<script>')).toBeNull();
    expect(model.clientIp('1.2.3.4', 2)).toBeNull();
  });
});

describe('mensagem do 429', () => {
  it('diz quando tentar de novo, em minuto ou hora', () => {
    expect(model.retryMessage(30)).toBe('Muitas tentativas seguidas. Tente de novo em 1 minuto.');
    expect(model.retryMessage(1500)).toBe('Muitas tentativas seguidas. Tente de novo em 25 minutos.');
    expect(model.retryMessage(3600 * 5)).toBe('Muitas tentativas seguidas. Tente de novo em 5 horas.');
    expect(model.retryMessage(5400)).toBe('Muitas tentativas seguidas. Tente de novo em 2 horas.');
  });
});

describe('criar conta', () => {
  const body = { idToken: 'aaa.bbb.ccc', kind: 'empresa', name: 'Doce Ponto' };

  it('conta pelo IP e depois pelo e-mail do token, e cria a conta', async () => {
    const res = await post(account, '/api/account', body);
    expect(res.status).toBe(201);
    expect(rate.calls).toEqual([['account.ip', '203.0.113.7'], ['account.email', 'ana@exemplo.test']]);
  });

  it('IP no teto: 429 com Retry-After, sem verificar o token nem criar conta', async () => {
    rate.blocked.add('account.ip');
    const res = await post(account, '/api/account', body);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1500');
    expect(await res.json()).toEqual({ error: 'Muitas tentativas seguidas. Tente de novo em 25 minutos.', code: 'rate_limited' });
    expect(identityMock.calls).toBe(0);
    expect(created).toEqual([]);
  });

  it('e-mail no teto: 429 sem criar conta', async () => {
    rate.blocked.add('account.email');
    expect((await post(account, '/api/account', body)).status).toBe(429);
    expect(created).toEqual([]);
  });
});

describe('aceitar convite', () => {
  const body = { idToken: 'aaa.bbb.ccc', token: 'a'.repeat(43) };

  it('IP no teto: 429 antes de verificar o token', async () => {
    rate.blocked.add('accept.ip');
    const res = await post(accept, '/api/invitations/accept', body);
    expect(res.status).toBe(429);
    expect(identityMock.calls).toBe(0);
  });

  it('e-mail no teto: 429 antes de tocar no convite', async () => {
    rate.blocked.add('accept.email');
    expect((await post(accept, '/api/invitations/accept', body)).status).toBe(429);
    expect(rate.calls.map(([b]) => b)).toEqual(['accept.ip', 'accept.email']);
  });
});
