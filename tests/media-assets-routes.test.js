import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sessão e banco de imagens simulados: aqui só a ligação das rotas (permissão, validação dos bytes,
// limites do lote, o que grava e devolve). O banco tem teste em tests/db/media-assets.integration.test.js.
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
    requireSession: async () => ({ t: { tenantId: 'acme' }, role: 'admin', user: { id: 'u1' } }),
  };
});
const lib = { saved: [], listed: [], patched: [], deleted: [], file: null, asset: null };
vi.mock('@/lib/media-assets', () => ({
  listMediaAssets: async (_t, q) => (lib.listed.push(q), []),
  saveMediaAssets: async (_t, _u, photos) => (lib.saved.push(...photos), photos.map((p, i) => ({ id: `a${i}`, width: p.photo.width }))),
  getMediaAsset: async () => lib.asset,
  updateMediaAsset: async (_t, _u, id, patch) => (lib.patched.push([id, patch]), { id }),
  deleteMediaAsset: async (_t, _u, id) => void lib.deleted.push(id),
  readMediaAssetBytes: async () => lib.file,
}));

const list = await import('../platform/src/app/api/media-assets/route.ts');
const one = await import('../platform/src/app/api/media-assets/[id]/route.ts');
const file = await import('../platform/src/app/api/media-assets/[id]/file/route.ts');
const { ForbiddenError } = await import('@/lib/session');

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(640), ...be32(800), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND')]);
const upload = (files) => {
  const form = new FormData();
  for (const [bytes, name] of files) form.append('files', new File([bytes], name, { type: 'image/jpeg' }));
  return list.POST(new Request('http://app.test/api/media-assets', { method: 'POST', body: form }));
};
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  Object.assign(lib, { saved: [], listed: [], patched: [], deleted: [], file: null, asset: null });
});

describe('GET/POST /api/media-assets', () => {
  it('lista com content.view e os filtros da query', async () => {
    const res = await list.GET(new Request('http://app.test/api/media-assets?filter=used&tag=equipe'));
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.view']);
    expect(lib.listed[0]).toEqual({ filter: 'used', tag: 'equipe', limit: 60 });
  });

  it('sobe o lote com content.create; o tipo vem dos bytes, não do nome', async () => {
    const res = await upload([[PNG, 'bolo.jpg'], [PNG, '../x.png']]);
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.create']);
    expect(lib.saved.map((p) => [p.photo.contentType, p.name])).toEqual([['image/png', 'bolo.jpg'], ['image/png', 'x.png']]);
  });

  it('uma foto ruim recusa o lote inteiro com o nome dela, e nada é gravado', async () => {
    const res = await upload([[PNG, 'bolo.png'], [new TextEncoder().encode('<svg/>'), 'logo.svg']]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^logo\.svg: /);
    expect(lib.saved).toEqual([]);
  });

  it('sem arquivo, ou mais de 10, é 400', async () => {
    expect((await upload([])).status).toBe(400);
    expect((await upload(Array.from({ length: 11 }, (_, i) => [PNG, `${i}.png`]))).status).toBe(400);
  });

  it('leitor sem content.create recebe 403', async () => {
    sessionMock.error = new ForbiddenError();
    expect((await upload([[PNG, 'a.png']])).status).toBe(403);
  });
});

describe('/api/media-assets/[id]', () => {
  it('id fora do formato é 404 sem ir ao banco', async () => {
    expect((await one.GET(new Request('http://x'), ctx('../etc'))).status).toBe(404);
    expect((await one.DELETE(new Request('http://x'), ctx('1'))).status).toBe(404);
    expect(lib.deleted).toEqual([]);
  });

  it('PATCH valida e pede content.edit; DELETE também', async () => {
    const bad = await one.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ tags: ['gato'] }) }), ctx());
    expect(bad.status).toBe(400);
    const ok = await one.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ people_consent: true }) }), ctx());
    expect(ok.status).toBe(200);
    expect(lib.patched).toEqual([[ID, { people_consent: true }]]);
    expect((await one.DELETE(new Request('http://x'), ctx())).status).toBe(200);
    expect(lib.deleted).toEqual([ID]);
    expect(sessionMock.calls).toEqual(['content.edit', 'content.edit', 'content.edit']);
  });

  it('o arquivo sai com sessão, nosniff e cache privado', async () => {
    expect((await file.GET(new Request('http://x'), ctx())).status).toBe(404);
    lib.file = { bytes: PNG, contentType: 'image/png' };
    const res = await file.GET(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    expect(sessionMock.calls).toEqual(['content.view', 'content.view']);
  });
});
