import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O portão do console (docs/arquitetura/ultra-admin.md): cada "não" vira ConsoleDeniedError, com o
// motivo só no log, e só quem passa por todos recebe a pessoa de volta. Sessão, banco e provedor de
// login simulados.
const state = { user: { id: 'u1', name: 'Dono', sessionVersion: 1, lastTenantId: null }, email: 'dono@exemplo.test', row: { user_id: 'u1' }, uid: 'idp-1', factor: true, dbError: null, expired: false };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: async () => {
      if (state.expired) throw new UnauthorizedError();
      return { user: state.user, role: 'admin', t: { tenantId: 'acme' } };
    },
  };
});
vi.mock('@/lib/accounts', () => ({
  personProfiles: async () => new Map(state.email ? [['u1', { email: state.email, name: null }]] : []),
  idpUidOf: async () => state.uid,
}));
vi.mock('@/lib/db', () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: state.dbError }) }) }),
    }),
  }),
}));
vi.mock('@/lib/identity', () => ({ hasSecondFactor: async () => state.factor }));
const logs = [];
vi.mock('@/lib/log', () => ({ log: (...a) => void logs.push(a), logError: () => {} }));

const { ConsoleDeniedError, emailMatches, pageConsole, requirePlatformAdmin } = await import('@/lib/platform-admin');

const denied = async () => requirePlatformAdmin().then(() => null, (e) => e);

beforeEach(() => {
  process.env.PLATFORM_ADMIN_EMAIL = 'Dono@Exemplo.test';
  process.env.MFA_MODE = 'required';
  Object.assign(state, { user: { id: 'u1', name: 'Dono', sessionVersion: 1, lastTenantId: null }, email: 'dono@exemplo.test', row: { user_id: 'u1' }, uid: 'idp-1', factor: true, dbError: null, expired: false });
  logs.length = 0;
});
afterEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAIL;
  delete process.env.MFA_MODE;
});

describe('emailMatches', () => {
  it('ignora caixa e espaço, e variável vazia nunca casa', () => {
    expect(emailMatches(' Dono@Exemplo.test ', 'dono@exemplo.TEST')).toBe(true);
    expect(emailMatches('', '')).toBe(false);
    expect(emailMatches(undefined, 'a@b.co')).toBe(false);
    expect(emailMatches('a@b.co', null)).toBe(false);
  });
});

describe('requirePlatformAdmin', () => {
  it('passa com os quatro portões abertos', async () => {
    expect(await requirePlatformAdmin()).toMatchObject({ user: { id: 'u1' }, email: 'dono@exemplo.test' });
  });

  it('sem login por pessoa (senha única), nega', async () => {
    state.user = null;
    expect(await denied()).toBeInstanceOf(ConsoleDeniedError);
  });

  it('sem PLATFORM_ADMIN_EMAIL ninguém entra, nem a pessoa certa', async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    expect((await denied()).reason).toBe('PLATFORM_ADMIN_EMAIL ausente');
    process.env.PLATFORM_ADMIN_EMAIL = '   ';
    expect((await denied()).reason).toBe('PLATFORM_ADMIN_EMAIL ausente');
  });

  it('e-mail diferente do configurado nega, mesmo estando na tabela', async () => {
    state.email = 'outra@exemplo.test';
    expect((await denied()).reason).toBe('e-mail diferente');
  });

  it('e-mail certo mas fora de platform_admins nega', async () => {
    state.row = null;
    expect((await denied()).reason).toBe('fora de platform_admins');
  });

  it('erro do banco não vira "negado": sobe como falha técnica', async () => {
    state.dbError = { message: 'caiu' };
    const e = await denied();
    expect(e).not.toBeInstanceOf(ConsoleDeniedError);
    expect(e.message).toMatch(/platform_admins/);
  });

  it('com duas etapas exigidas, sem elas ou sem leitura do provedor nega; no modo opcional não confere', async () => {
    state.factor = false;
    expect((await denied()).reason).toBe('sem duas etapas');
    state.factor = null;
    expect((await denied()).reason).toBe('sem duas etapas');
    state.uid = null;
    state.factor = true;
    expect((await denied()).reason).toBe('sem duas etapas');
    process.env.MFA_MODE = 'optional';
    state.factor = false;
    expect(await denied()).toBeNull();
  });

  it('o motivo vai para o log, sem e-mail, e a mensagem de quem pede é sempre a mesma', async () => {
    state.email = 'outra@exemplo.test';
    const e = await denied();
    expect(e.message).toBe('Não encontrado');
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain('outra@exemplo.test');
  });
});

describe('pageConsole', () => {
  it('"não" vira a página 404, sessão vencida leva ao login e quem passa recebe a pessoa', async () => {
    state.row = null;
    await expect(pageConsole()).rejects.toThrow(/404/);
    state.row = { user_id: 'u1' };
    state.expired = true;
    await expect(pageConsole()).rejects.toThrow(/NEXT_REDIRECT/);
    state.expired = false;
    expect(await pageConsole()).toMatchObject({ email: 'dono@exemplo.test' });
  });
});
