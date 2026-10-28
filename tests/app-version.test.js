import { describe, it, expect, afterEach } from 'vitest';
import { appVersion, hasNewVersion } from '../platform/src/lib/app-version.ts';

const { GET } = await import('../platform/src/app/api/version/route.ts');
const { middleware } = await import('../platform/src/middleware.ts');
const { NextRequest } = await import('../platform/node_modules/next/server.js');

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

// Aviso de versão nova (BEZ-427): a página guarda a revisão com que foi servida e pergunta a /api/version.
describe('versão do app', () => {
  it('usa APP_VERSION (7 caracteres), depois a revisão do Cloud Run, depois dev', () => {
    delete process.env.APP_VERSION;
    delete process.env.K_REVISION;
    expect(appVersion()).toBe('dev');
    process.env.K_REVISION = 'ekoai-00042-abc';
    expect(appVersion()).toBe('ekoai-00042-abc');
    process.env.APP_VERSION = '0123456789abcdef';
    expect(appVersion()).toBe('0123456');
  });

  it('avisa só quando o servidor responde outra versão', () => {
    expect(hasNewVersion('rev-1', 'rev-2')).toBe(true);
    expect(hasNewVersion('rev-1', 'rev-1')).toBe(false);
  });

  it('não avisa em dev nem sem resposta válida', () => {
    expect(hasNewVersion('dev', 'rev-2')).toBe(false);
    expect(hasNewVersion('rev-1', null)).toBe(false);
    expect(hasNewVersion('rev-1', '')).toBe(false);
    expect(hasNewVersion('rev-1', undefined)).toBe(false);
  });
});

describe('GET /api/version', () => {
  it('devolve a versão sem cache e sem sessão', async () => {
    delete process.env.APP_VERSION;
    process.env.K_REVISION = 'ekoai-00042-abc';
    const res = GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ version: 'ekoai-00042-abc' });
    const gate = await middleware(new NextRequest('http://x/api/version'));
    expect(gate.headers.get('x-middleware-next')).toBe('1');
  });

  it('o caminho público é só o exato', async () => {
    const gate = await middleware(new NextRequest('http://x/api/version/x'));
    expect(gate.headers.get('x-middleware-next')).not.toBe('1');
  });
});
