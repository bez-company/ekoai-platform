import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sessão e armazenamento simulados: aqui só a ligação da rota (permissão, validação de bytes, o que
// grava e o que devolve). O banco e a ordem das escritas têm teste em tests/db/brand-logo.integration.test.js.
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
const logoMock = { saved: [], removed: 0, logo: null, saveError: null };
vi.mock('@/lib/brand-logo', () => ({
  readLogo: async () => logoMock.logo,
  saveLogo: async (_t, _u, logo) => {
    if (logoMock.saveError) throw logoMock.saveError;
    logoMock.saved.push(logo);
    return { assetId: 'asset-1' };
  },
  removeLogo: async () => void (logoMock.removed += 1),
}));

const { GET, POST, DELETE } = await import('../platform/src/app/api/brand/logo/route.ts');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');
const { UserError } = await import('@/lib/errors');

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(8), ...be32(8), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND')]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="#B83262"/></svg>';
const upload = (bytes, name = 'logo.png', type = 'image/png', headers = {}) => {
  const form = new FormData();
  form.set('file', new File([bytes], name, { type }));
  return POST(new Request('http://app.test/api/brand/logo', { method: 'POST', body: form, headers }));
};

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(logoMock, { saved: [], removed: 0, logo: null, saveError: null });
});

describe('GET /api/brand/logo', () => {
  it('pede profile.view; sem logo é 404', async () => {
    expect((await GET()).status).toBe(404);
    expect(sessionMock.calls).toEqual(['profile.view']);
  });

  it('devolve o arquivo com cabeçalhos que impedem script e cache público', async () => {
    logoMock.logo = { bytes: new TextEncoder().encode(SVG), contentType: 'image/svg+xml', assetId: 'a' };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'.*sandbox/);
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    expect(await res.text()).toBe(SVG);
  });

  it('sem sessão 401, sem permissão 403 (leitor)', async () => {
    sessionMock.error = new UnauthorizedError();
    expect((await GET()).status).toBe(401);
    sessionMock.error = new ForbiddenError();
    expect((await GET()).status).toBe(403);
  });
});

describe('POST /api/brand/logo', () => {
  it('PNG válido: pede brand.manage e grava com o tipo dos bytes', async () => {
    const res = await upload(PNG);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assetId: 'asset-1' });
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(logoMock.saved[0]).toMatchObject({ contentType: 'image/png', ext: 'png' });
  });

  it('o tipo declarado e o nome não valem: um SVG enviado como .png vira SVG reescrito', async () => {
    const res = await upload(new TextEncoder().encode(SVG), 'foto.png', 'image/png');
    expect(res.status).toBe(200);
    expect(logoMock.saved[0]).toMatchObject({ contentType: 'image/svg+xml', ext: 'svg' });
  });

  it('SVG hostil é recusado com a mensagem e nada é gravado', async () => {
    const res = await upload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.svg', 'image/svg+xml');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/<script>/);
    expect(logoMock.saved).toEqual([]);
  });

  it('arquivo que não é PNG nem SVG, ou vazio', async () => {
    expect((await (await upload(new TextEncoder().encode('%PDF-1.7'), 'a.png')).json()).error).toMatch(/PNG ou SVG/);
    expect((await upload(new Uint8Array())).status).toBe(400);
  });

  it('acima de 2 MB: recusa pelo cabeçalho e pelo arquivo', async () => {
    const res1 = await upload(PNG, 'a.png', 'image/png', { 'content-length': String(5 * 1024 * 1024) });
    expect(res1.status).toBe(400);
    expect((await res1.json()).error).toMatch(/2 MB/);
    const res2 = await upload(new Uint8Array(2 * 1024 * 1024 + 1));
    expect(res2.status).toBe(400);
    expect(logoMock.saved).toEqual([]);
  });

  it('sem campo file ou corpo que não é multipart: 400', async () => {
    const form = new FormData();
    form.set('outro', 'x');
    expect((await POST(new Request('http://app.test/x', { method: 'POST', body: form }))).status).toBe(400);
    expect((await POST(new Request('http://app.test/x', { method: 'POST', body: 'texto' }))).status).toBe(400);
  });

  it('criador e leitor recebem 403 e nada é gravado', async () => {
    sessionMock.error = new ForbiddenError();
    expect((await upload(PNG)).status).toBe(403);
    expect(logoMock.saved).toEqual([]);
  });

  it('perfil ainda sem a seção Sobre: a mensagem do servidor chega', async () => {
    logoMock.saveError = new UserError('Preencha primeiro a seção Sobre o negócio.');
    const res = await upload(PNG);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Preencha primeiro a seção Sobre o negócio.');
  });

  it('erro técnico: 500 neutro', async () => {
    logoMock.saveError = new Error('bucket: senha=abc');
    const res = await upload(PNG);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('senha');
  });
});

describe('DELETE /api/brand/logo', () => {
  it('pede brand.manage e remove', async () => {
    expect((await DELETE()).status).toBe(200);
    expect(sessionMock.calls).toEqual(['brand.manage']);
    expect(logoMock.removed).toBe(1);
  });

  it('sem permissão: 403', async () => {
    sessionMock.error = new ForbiddenError();
    expect((await DELETE()).status).toBe(403);
    expect(logoMock.removed).toBe(0);
  });
});
