import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sessão (cookie) e contas (banco) controladas pelo teste.
const jar = { value: undefined };
// a session.ts resolve o Next pela node_modules da plataforma; o mock precisa ser o mesmo arquivo
vi.mock('../platform/node_modules/next/headers.js', () => ({ cookies: async () => ({ get: () => (jar.value ? { value: jar.value } : undefined) }) }));
vi.mock('../platform/node_modules/next/navigation.js', () => ({ redirect: (to) => { throw new Error(`redirect ${to}`); } }));
const accounts = { user: null, role: null, granted: new Set(), creatorCanApprove: false };
vi.mock('../platform/src/lib/accounts.ts', () => ({
  sessionUser: async (id) => (accounts.user && accounts.user.id === id ? accounts.user : null),
  roleIn: async () => accounts.role,
  hasPermission: async (role, _tenant, permission) => {
    const { allows } = await import('../platform/src/lib/permissions.ts');
    return allows(role, accounts.granted, permission, accounts.creatorCanApprove);
  },
}));

const auth = await import('../platform/src/lib/auth.ts');
const session = await import('../platform/src/lib/session.ts');
const policy = await import('../platform/src/lib/login-policy.ts');
const { allows, PERMISSIONS } = await import('../platform/src/lib/permissions.ts');
const { parseSessionBody, parseTenantSwitch } = await import('../platform/src/lib/route-input.ts');

const USER = '00000000-0000-4000-8000-00000000000a';
const now = () => Math.floor(Date.now() / 1000);
const identity = (over = {}) => ({ uid: 'idp-a', email: 'a@x.com', emailVerified: true, authTime: now(), secondFactor: null, ...over });
const member = (tenantId, role, createdAt = '2026-01-01T00:00:00Z') => ({ tenantId, role, createdAt });

beforeEach(() => {
  process.env.AUTH_SECRET = 'segredo-de-teste';
  process.env.AUTH_PROVIDER = 'identity';
  jar.value = undefined;
  Object.assign(accounts, { user: { id: USER, sessionVersion: 3, lastTenantId: null }, role: 'viewer', granted: new Set(['content.view', 'content.feedback']), creatorCanApprove: false });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AUTH_PROVIDER;
});

describe('sessão por pessoa assinada', () => {
  it('ida e volta com pessoa, conta e versão', async () => {
    const token = await auth.createUserSessionToken({ userId: USER, tenantId: 'acme', sessionVersion: 3 });
    expect(await auth.verifySessionToken(token)).toEqual({ userId: USER, tenantId: 'acme', sessionVersion: 3 });
  });

  it('trocar a conta, a versão ou a assinatura invalida', async () => {
    const token = await auth.createUserSessionToken({ userId: USER, tenantId: 'acme', sessionVersion: 3 });
    expect(await auth.verifySessionToken(token.replace('.acme.', '.beta.'))).toBeNull();
    expect(await auth.verifySessionToken(token.replace('.3.', '.4.'))).toBeNull();
    expect(await auth.verifySessionToken(`${token.slice(0, -2)}xx`)).toBeNull();
  });

  it('vence em 7 dias', async () => {
    vi.useFakeTimers();
    const token = await auth.createUserSessionToken({ userId: USER, tenantId: 'acme', sessionVersion: 1 });
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    expect(await auth.verifySessionToken(token)).toBeNull();
  });

  it('dado inválido não vira sessão', async () => {
    await expect(auth.createUserSessionToken({ userId: 'nao-e-uuid', tenantId: 'acme', sessionVersion: 1 })).rejects.toThrow();
    await expect(auth.createUserSessionToken({ userId: USER, tenantId: 'acme', sessionVersion: 0 })).rejects.toThrow();
  });

  it('a sessão de senha única segue valendo', async () => {
    const token = await auth.createSessionToken('beta');
    expect(await auth.verifySessionToken(token)).toEqual({ tenantId: 'beta', userId: null, sessionVersion: null });
  });
});

describe('regras do login', () => {
  it('login antigo, sem e-mail ou não verificado é recusado antes do banco', () => {
    expect(policy.identityRefusal(identity({ authTime: now() - 6 * 60 }), now()).code).toBe('login_stale');
    expect(policy.identityRefusal(identity({ email: null }), now()).code).toBe('email_missing');
    expect(policy.identityRefusal(identity({ emailVerified: false }), now()).code).toBe('email_not_verified');
    expect(policy.identityRefusal(identity(), now())).toBeNull();
  });

  it('sem conta não entra; administrador precisa de segundo fator', () => {
    expect(policy.membershipRefusal(identity(), []).code).toBe('no_access');
    expect(policy.membershipRefusal(identity(), [member('acme', 'admin')]).code).toBe('mfa_required');
    expect(policy.membershipRefusal(identity({ secondFactor: 'totp' }), [member('acme', 'admin')])).toBeNull();
    expect(policy.membershipRefusal(identity(), [member('acme', 'creator'), member('beta', 'viewer')])).toBeNull();
  });

  it('conta: a pedida, senão a última, senão a mais antiga', () => {
    const ms = [member('beta', 'viewer', '2026-03-01T00:00:00Z'), member('acme', 'creator', '2026-01-01T00:00:00Z')];
    expect(policy.pickTenant(ms, 'beta', null)).toEqual({ tenantId: 'beta', role: 'viewer' });
    expect(policy.pickTenant(ms, 'gama', null).code).toBe('not_member');
    expect(policy.pickTenant(ms, undefined, 'beta')).toEqual({ tenantId: 'beta', role: 'viewer' });
    expect(policy.pickTenant(ms, undefined, 'saiu')).toEqual({ tenantId: 'acme', role: 'creator' });
  });

  it('o corpo do login barra lixo antes de chamar a rede', () => {
    expect(parseSessionBody({ idToken: 'nao-e-jwt' }).ok).toBe(false);
    expect(parseSessionBody({ idToken: 'a.b.c', tenantId: 'Conta Inválida' }).ok).toBe(false);
    expect(parseSessionBody({ idToken: 'aaa.bbb.ccc', tenantId: 'acme' })).toEqual({ ok: true, value: { idToken: 'aaa.bbb.ccc', tenantId: 'acme' } });
    expect(parseTenantSwitch({}).ok).toBe(false);
  });
});

describe('permissões', () => {
  it('a matriz do TypeScript é a mesma da migration 0015', () => {
    const sql = readFileSync(join(import.meta.dirname, '../supabase/migrations/0015_portable_identity_and_roles.sql'), 'utf8');
    const seeded = [...sql.matchAll(/\('([a-z]+\.[a-z_]+)',\s+array\[/g)].map((m) => m[1]);
    expect([...seeded].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('criador aprova só com a conta liberando', () => {
    const creator = new Set(['content.edit']);
    expect(allows('creator', creator, 'content.approve', false)).toBe(false);
    expect(allows('creator', creator, 'content.approve', true)).toBe(true);
    expect(allows('viewer', new Set(['content.feedback']), 'content.approve', true)).toBe(false);
  });
});

describe('sessão conferida no servidor', () => {
  async function login(tenantId = 'acme', sessionVersion = 3) {
    jar.value = await auth.createUserSessionToken({ userId: USER, tenantId, sessionVersion });
  }

  it('leitor vê e dá feedback, mas não aprova', async () => {
    await login();
    expect((await session.requirePermission('content.view')).tenantId).toBe('acme');
    await session.requirePermission('content.feedback');
    await expect(session.requirePermission('content.approve')).rejects.toBeInstanceOf(session.ForbiddenError);
  });

  it('versão antiga da sessão (saiu de todos os dispositivos) não vale', async () => {
    await login('acme', 2);
    await expect(session.requireSession()).rejects.toBeInstanceOf(session.UnauthorizedError);
  });

  it('quem saiu da conta perde o acesso na próxima requisição', async () => {
    await login();
    accounts.role = null;
    await expect(session.requireSession()).rejects.toBeInstanceOf(session.UnauthorizedError);
  });

  it('pessoa apagada não entra', async () => {
    await login();
    accounts.user = null;
    await expect(session.requireSession()).rejects.toBeInstanceOf(session.UnauthorizedError);
  });

  it('um modo não aceita a sessão do outro', async () => {
    jar.value = await auth.createSessionToken('beta');
    await expect(session.requireSession()).rejects.toBeInstanceOf(session.UnauthorizedError);
    process.env.AUTH_PROVIDER = 'password';
    expect((await session.requireSession()).role).toBe('admin');
    await login();
    await expect(session.requireSession()).rejects.toBeInstanceOf(session.UnauthorizedError);
  });
});
