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

// Callbacks da Meta (SPEC 011 R5.4): públicos só no caminho exato; a página de status, só debaixo do prefixo.
describe('middleware: callbacks da Meta', () => {
  it('libera os dois callbacks e a página de status do pedido', async () => {
    expect(await pass('/api/instagram/deauthorize')).toBe(true);
    expect(await pass('/api/instagram/data-deletion')).toBe(true);
    expect(await pass('/instagram/exclusao/AbCdEf0123456789_-xy')).toBe(true);
  });

  it('não libera o resto do Instagram nem variação do caminho', async () => {
    expect(await pass('/api/instagram/connect')).toBe(false);
    expect(await pass('/api/instagram/deauthorize/x')).toBe(false);
    expect(await pass('/api/instagram/data-deletionx')).toBe(false);
    expect(await pass('/instagram/exclusao')).toBe(false);
  });
});

// Ícone da aba: sem sessão a tela de entrada o pede; se o gate rodasse nele, voltaria o redirecionamento
// para /entrar e a aba ficaria sem ícone até o login (BEZ-359).
describe('middleware: matcher', () => {
  it('deixa o ícone e o favicon fora do gate e mantém o resto dentro', async () => {
    const { config } = await import('../platform/src/middleware.ts');
    const gated = new RegExp(`^${config.matcher[0]}$`);
    expect(gated.test('/icon.svg')).toBe(false);
    expect(gated.test('/favicon.ico')).toBe(false);
    expect(gated.test('/aprovar')).toBe(true);
    expect(gated.test('/api/posts')).toBe(true);
  });
});
