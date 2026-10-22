import { describe, it, expect } from 'vitest';

const { middleware } = await import('../platform/src/middleware.ts');
const { NextRequest } = await import('../platform/node_modules/next/server.js');

const pass = async (path) => (await middleware(new NextRequest(`http://x${path}`))).headers.get('x-middleware-next') === '1';

// A mídia pública é só /api/media/<chave> (ADR 0009). O banco de imagens (/api/media-assets) tem a
// foto da empresa ainda não publicada: exige sessão já no middleware.
describe('middleware: mídia pública x banco de imagens', () => {
  it('libera a mídia dos posts', async () => {
    expect(await pass('/api/media/images/0f8fad5b-d9cb-469f-a165-70867728950e.png')).toBe(true);
  });

  it('não libera o banco de imagens nem a rota sem barra', async () => {
    expect(await pass('/api/media-assets')).toBe(false);
    expect(await pass('/api/media-assets/0f8fad5b-d9cb-469f-a165-70867728950e/file')).toBe(false);
    expect(await pass('/api/mediax')).toBe(false);
  });
});
