import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sessão e dados simulados: aqui só a ligação da rota (permissão, 400 com o campo, o que grava).
// As regras do banco e a auditoria têm teste próprio em tests/db/company-profile.integration.test.js.
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
const dataMock = { saved: [], profile: { niche: 'Moda' }, saveError: null };
vi.mock('@/lib/company-profile', () => ({
  getProfile: async () => dataMock.profile,
  saveSection: async (_t, _u, parsed) => {
    if (dataMock.saveError) throw dataMock.saveError;
    dataMock.saved.push(parsed);
  },
}));

const { GET, PUT } = await import('../platform/src/app/api/profile/route.ts');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');
const { UserError } = await import('@/lib/errors');

const put = (body) => PUT(new Request('http://app.test/api/profile', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const about = { section: 'about', niche: 'Moda', offering: 'Roupas', audience: 'Mulheres' };

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(dataMock, { saved: [], saveError: null });
});

describe('GET /api/profile', () => {
  it('pede profile.view e devolve o perfil (ou null)', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: { niche: 'Moda' } });
    expect(sessionMock.calls).toEqual(['profile.view']);
    dataMock.profile = null;
    expect(await (await GET()).json()).toEqual({ profile: null });
  });

  it('sem sessão 401, sem permissão 403', async () => {
    sessionMock.error = new UnauthorizedError();
    expect((await GET()).status).toBe(401);
    sessionMock.error = new ForbiddenError();
    expect((await GET()).status).toBe(403);
  });
});

describe('PUT /api/profile', () => {
  it('pede brand.manage e grava a seção já validada', async () => {
    const res = await put({ ...about, region: ' Marília ', tenant_id: 'outra' });
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(dataMock.saved).toHaveLength(1);
    expect(dataMock.saved[0]).toMatchObject({ section: 'about', values: { niche: 'Moda', region: 'Marília' } });
    expect(dataMock.saved[0].values).not.toHaveProperty('tenant_id');
  });

  it('leitor e criador (sem brand.manage) recebem 403 e nada é gravado', async () => {
    sessionMock.error = new ForbiddenError();
    expect((await put(about)).status).toBe(403);
    expect(dataMock.saved).toEqual([]);
  });

  it('campo inválido: 400 com a mensagem e o nome do campo, sem gravar', async () => {
    const res = await put({ ...about, niche: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Escolha o nicho.', fields: { niche: 'Escolha o nicho.' } });
    expect(dataMock.saved).toEqual([]);
  });

  it('corpo que não é JSON ou sem seção: 400', async () => {
    expect((await put('{{')).status).toBe(400);
    const res = await put({ niche: 'Moda' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Seção do perfil inválida/);
  });

  it('seção opcional antes do perfil existir: a mensagem do servidor chega na tela', async () => {
    dataMock.saveError = new UserError('Preencha primeiro a seção Sobre o negócio.');
    const res = await put({ section: 'voice' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Preencha primeiro a seção Sobre o negócio.');
  });

  it('erro técnico: 500 neutro, sem vazar a causa', async () => {
    dataMock.saveError = new Error('connection terminated: senha=abc');
    const res = await put(about);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('senha');
  });
});
