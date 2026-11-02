import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns';
import { MAX_REDIRECTS, ReadFailure, fetchPublic, httpsTransport } from '../platform/src/lib/site-read/fetch.ts';

const signal = () => new AbortController().signal;
const res = (over = {}) => ({ status: 200, location: null, contentType: 'text/html', body: Buffer.from('ok'), ...over });
const kind = async (p) => (await p.catch((e) => e)).kind;

afterEach(() => vi.restoreAllMocks());

describe('busca com redirecionamento conferido', () => {
  it('devolve a resposta final e a URL em que parou', async () => {
    const seen = [];
    const transport = async (url) => {
      seen.push(url.toString());
      return url.pathname === '/a' ? res({ status: 301, location: '/b' }) : res({ body: Buffer.from('final') });
    };
    const out = await fetchPublic(new URL('https://doceponto.com.br/a'), { accept: 'text/html', signal: signal(), transport });
    expect(seen).toEqual(['https://doceponto.com.br/a', 'https://doceponto.com.br/b']);
    expect(out.url.pathname).toBe('/b');
    expect(out.body.toString()).toBe('final');
  });

  it('redirecionamento para http, IP interno ou nome interno é recusado antes de abrir a conexão', async () => {
    for (const location of ['http://doceponto.com.br/', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.1/', 'https://intranet.local/', 'https://localhost/']) {
      const transport = vi.fn(async () => (transport.mock.calls.length === 1 ? res({ status: 302, location }) : res()));
      expect(await kind(fetchPublic(new URL('https://doceponto.com.br/'), { accept: '*/*', signal: signal(), transport })), location).toBe('blocked');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it('mais de 3 redirecionamentos é recusado', async () => {
    const transport = vi.fn(async (url) => res({ status: 302, location: `/r${Number(url.pathname.slice(2) || 0) + 1}` }));
    expect(await kind(fetchPublic(new URL('https://doceponto.com.br/'), { accept: '*/*', signal: signal(), transport }))).toBe('redirects');
    expect(transport).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('erro de rede vira "network"; falha conhecida passa como veio; 404 volta como resposta', async () => {
    const run = (transport) => fetchPublic(new URL('https://doceponto.com.br/'), { accept: '*/*', signal: signal(), transport });
    expect(await kind(run(async () => { throw new Error('ECONNRESET'); }))).toBe('network');
    expect(await kind(run(async () => { throw new ReadFailure('timeout', 'x'); }))).toBe('timeout');
    expect((await run(async () => res({ status: 404 }))).status).toBe(404);
  });

  it('a URL inicial também passa pelas regras', async () => {
    const transport = vi.fn(async () => res());
    expect(await kind(fetchPublic(new URL('https://127.0.0.1/'), { accept: '*/*', signal: signal(), transport }))).toBe('blocked');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('o DNS é conferido na hora de conectar (transporte de verdade)', () => {
  const lookupReturning = (addresses) => vi.spyOn(dns, 'lookup').mockImplementation((host, opts, cb) => cb(null, addresses));

  it('nome público que resolve para IP interno não conecta', async () => {
    const spy = lookupReturning([{ address: '127.0.0.1', family: 4 }]);
    const out = await httpsTransport(new URL('https://rebind.example.test/'), { accept: '*/*', signal: signal() }).catch((e) => e);
    expect(spy).toHaveBeenCalled();
    expect(out.kind).toBe('blocked');
  });

  it('basta um endereço interno entre os devolvidos para recusar', async () => {
    lookupReturning([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.9', family: 4 }]);
    const out = await httpsTransport(new URL('https://misto.example.test/'), { accept: '*/*', signal: signal() }).catch((e) => e);
    expect(out.kind).toBe('blocked');
  });

  it('metadados da nuvem e IPv6 mapeado também', async () => {
    for (const address of ['169.254.169.254', '::ffff:169.254.169.254', '::1', 'fd00::1']) {
      lookupReturning([{ address, family: address.includes(':') ? 6 : 4 }]);
      const out = await httpsTransport(new URL('https://x.example.test/'), { accept: '*/*', signal: signal() }).catch((e) => e);
      expect(out.kind, address).toBe('blocked');
    }
  });

  it('sinal já abortado não abre conexão', async () => {
    const spy = lookupReturning([{ address: '8.8.8.8', family: 4 }]);
    const ctl = new AbortController();
    ctl.abort();
    const out = await httpsTransport(new URL('https://doceponto.example.test/'), { accept: '*/*', signal: ctl.signal }).catch((e) => e);
    expect(out.kind).toBe('timeout');
    expect(spy).not.toHaveBeenCalled();
  });
});
