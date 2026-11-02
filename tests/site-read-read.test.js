import { describe, it, expect } from 'vitest';
import { readSite } from '../platform/src/lib/site-read/read.ts';
import { UserError } from '../platform/src/lib/errors.ts';

const page = (over = {}) => ({ status: 200, location: null, contentType: 'text/html; charset=utf-8', body: Buffer.from(''), ...over });
const HTML = '<title>Doce Ponto</title><meta name="theme-color" content="#B83262"><link rel="stylesheet" href="/s.css"><link rel="stylesheet" href="/quebrada.css">';

function site(map) {
  const calls = [];
  const transport = async (url) => {
    calls.push(url.pathname);
    const hit = map[url.pathname];
    if (hit instanceof Error) throw hit;
    return hit ?? page({ status: 404 });
  };
  return { transport, calls };
}

const fail = async (p) => (await p.catch((e) => e));

describe('ler o site', () => {
  it('lê robots.txt, a página e as folhas, e devolve as sugestões; folha que falha não derruba a leitura', async () => {
    const { transport, calls } = site({
      '/robots.txt': page({ contentType: 'text/plain', body: Buffer.from('User-agent: *\nDisallow: /admin') }),
      '/': page({ body: Buffer.from(HTML) }),
      '/s.css': page({ contentType: 'text/css', body: Buffer.from('.a{background:#2f7d6b}') }),
      '/quebrada.css': new Error('ECONNRESET'),
    });
    const read = await readSite('doceponto.com.br', { transport });
    expect(read.name).toBe('Doce Ponto');
    expect(read.colors).toEqual(['#B83262', '#2F7D6B']);
    expect(calls[0]).toBe('/robots.txt');
    expect(calls).toContain('/s.css');
  });

  it('robots.txt que proíbe a página: para e diz o próximo passo', async () => {
    const { transport, calls } = site({ '/robots.txt': page({ body: Buffer.from('User-agent: *\nDisallow: /') }), '/': page({ body: Buffer.from(HTML) }) });
    const err = await fail(readSite('doceponto.com.br', { transport }));
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toMatch(/Respeitamos isso: preencha à mão/);
    expect(calls).toEqual(['/robots.txt']);
  });

  it('sem robots.txt (404 ou erro) vale como liberado', async () => {
    for (const robots of [page({ status: 404 }), new Error('boom')]) {
      const { transport } = site({ '/robots.txt': robots, '/': page({ body: Buffer.from(HTML) }) });
      expect((await readSite('doceponto.com.br', { transport })).name).toBe('Doce Ponto');
    }
  });

  it('erro do site, outro tipo de arquivo, falha de rede e tempo esgotado viram mensagem para a pessoa', async () => {
    const cases = [
      [{ '/': page({ status: 500 }) }, /respondeu com erro/],
      [{ '/': page({ contentType: 'application/pdf', body: Buffer.from('%PDF') }) }, /não devolveu uma página/],
      [{ '/': new Error('ENOTFOUND') }, /Não conseguimos abrir o site/],
    ];
    for (const [map, message] of cases) {
      const { transport } = site(map);
      const err = await fail(readSite('doceponto.com.br', { transport }));
      expect(err, String(message)).toBeInstanceOf(UserError);
      expect(err.message).toMatch(message);
    }
  });

  it('endereço inválido ou interno nem chega à rede', async () => {
    const { transport, calls } = site({});
    for (const raw of ['', 'doceponto', 'http://localhost', 'https://169.254.169.254/', 'https://10.0.0.1']) {
      const err = await fail(readSite(raw, { transport }));
      expect(err, raw).toBeInstanceOf(UserError);
    }
    expect(calls).toEqual([]);
  });

  it('redirecionamento do site para a rede interna é recusado com a mensagem de endereço', async () => {
    const { transport } = site({ '/robots.txt': page({ status: 404 }), '/': page({ status: 302, location: 'https://169.254.169.254/latest/meta-data/' }) });
    const err = await fail(readSite('doceponto.com.br', { transport }));
    expect(err.message).toMatch(/Não conseguimos ler este endereço/);
  });
});
