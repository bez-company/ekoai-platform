import { describe, it, expect } from 'vitest';
import { fanOut, pathOf, stepTimer } from '../platform/src/lib/site-read/progress-model.ts';
import { readSitePages } from '../platform/src/lib/site-read/read.ts';

const page = (over = {}) => ({ status: 200, location: null, contentType: 'text/html; charset=utf-8', body: Buffer.from(''), ...over });
const text = (n) => 'Bolos e doces feitos à mão para a sua festa. '.repeat(n);
const HOME = `<title>Doce Ponto</title><meta name="theme-color" content="#B83262"><link rel="stylesheet" href="/s.css"><a href="/sobre">Sobre</a><a href="/cardapio">Cardápio</a><body><p>${text(4)}</p></body>`;

function site(map) {
  const transport = async (url) => {
    const hit = map[url.pathname];
    if (hit instanceof Error) throw hit;
    return hit ?? page({ status: 404 });
  };
  return transport;
}

describe('medir os passos da leitura', () => {
  it('mede do início ao resultado de cada passo e soma o total', () => {
    let t = 1000;
    const timer = stepTimer(() => t);
    timer.probe({ type: 'started', kind: 'site', label: 'Abrindo' });
    t += 300;
    timer.probe({ type: 'result', kind: 'site' });
    timer.probe({ type: 'started', kind: 'model', label: 'Entendendo' });
    t += 2000;
    timer.probe({ type: 'failed', kind: 'model', message: 'caiu' });
    t += 50;
    expect(timer.summary()).toEqual({
      total_ms: 2350,
      steps: [
        { kind: 'site', path: null, ms: 300, ok: true },
        { kind: 'model', path: null, ms: 2000, ok: false },
      ],
    });
  });

  it('separa as páginas pelo endereço e guarda só o caminho, sem consulta', () => {
    let t = 0;
    const timer = stepTimer(() => t);
    timer.probe({ type: 'started', kind: 'page', label: 'Lendo', url: 'https://doceponto.com.br/cardapio?token=abc' });
    timer.probe({ type: 'started', kind: 'page', label: 'Lendo', url: 'https://doceponto.com.br/sobre' });
    t += 120;
    timer.probe({ type: 'result', kind: 'page', url: 'https://doceponto.com.br/sobre', chars: 500 });
    t += 80;
    timer.probe({ type: 'failed', kind: 'page', message: 'não abriu', url: 'https://doceponto.com.br/cardapio?token=abc' });
    const { steps } = timer.summary();
    expect(steps).toEqual([
      { kind: 'page', path: '/sobre', ms: 120, ok: true },
      { kind: 'page', path: '/cardapio', ms: 200, ok: false },
    ]);
  });

  it('resultado sem início não entra e endereço inválido vira sem caminho', () => {
    const timer = stepTimer(() => 5);
    timer.probe({ type: 'result', kind: 'logo', logoUrl: null });
    expect(timer.summary().steps).toEqual([]);
    expect(pathOf('isso não é url')).toBeNull();
    expect(pathOf(undefined)).toBeNull();
  });

  it('um ouvinte que quebra não derruba os outros nem a leitura', () => {
    const seen = [];
    const probe = fanOut(() => { throw new Error('quebrou'); }, undefined, (e) => seen.push(e.kind));
    expect(() => probe({ type: 'started', kind: 'site', label: 'x' })).not.toThrow();
    expect(seen).toEqual(['site']);
  });
});

describe('a leitura avisa cada passo', () => {
  it('home, folha de estilo, páginas, logo, cores e identidade, nesta ordem de início e fim', async () => {
    const transport = site({
      '/': page({ body: Buffer.from(HOME) }),
      '/s.css': page({ contentType: 'text/css', body: Buffer.from('.a{background:#2f7d6b}') }),
      '/sobre': page({ body: Buffer.from(`<body><p>${text(3)}</p></body>`) }),
      '/cardapio': new Error('ECONNRESET'),
    });
    const events = [];
    const { read, pages } = await readSitePages('doceponto.com.br', { transport, probe: (e) => events.push(e) });
    expect(read.name).toBe('Doce Ponto');
    expect(pages.map((p) => new URL(p.url).pathname).sort()).toEqual(['/', '/sobre']);

    const kinds = events.map((e) => `${e.type}:${e.kind}`);
    expect(kinds[0]).toBe('started:site');
    expect(kinds).toContain('result:site');
    expect(kinds).toContain('started:css');
    expect(kinds).toContain('result:css');
    const resultAt = (k) => kinds.indexOf(`result:${k}`);
    expect(resultAt('site')).toBeLessThan(resultAt('logo'));

    expect(events.find((e) => e.type === 'started' && e.kind === 'site').label).toBe('Abrindo doceponto.com.br');
    expect(events.find((e) => e.type === 'result' && e.kind === 'css').count).toBe(1);
    expect(events.find((e) => e.type === 'result' && e.kind === 'colors').colors).toContain('#B83262');
    expect(events.find((e) => e.type === 'result' && e.kind === 'identity').name).toBe('Doce Ponto');
    // a página que não abriu vira falha só dela, com o endereço, e a leitura segue
    const bad = events.find((e) => e.type === 'failed' && e.kind === 'page');
    expect(new URL(bad.url).pathname).toBe('/cardapio');
    expect(bad.message).toMatch(/não abriu/);
    expect(events.filter((e) => e.type === 'result' && e.kind === 'page').map((e) => new URL(e.url).pathname)).toEqual(['/sobre']);
  });

  it('site que não abre: falha do passo "site", com a frase para a pessoa, e a leitura para', async () => {
    const events = [];
    const err = await readSitePages('doceponto.com.br', { transport: site({ '/': page({ status: 500 }) }), probe: (e) => events.push(e) }).catch((e) => e);
    expect(err.message).toMatch(/respondeu com erro/);
    const failed = events.filter((e) => e.type === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ kind: 'site', message: err.message });
    expect(events.some((e) => e.type === 'result' && e.kind === 'logo')).toBe(false);
  });

  it('sem ouvinte a leitura roda igual', async () => {
    const out = await readSitePages('doceponto.com.br', { transport: site({ '/': page({ body: Buffer.from(HOME) }) }) });
    expect(out.read.name).toBe('Doce Ponto');
  });

  it('logo, cores e identidade saem assim que a folha de estilo chega, antes de qualquer página lida', async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const transport = async (url) => {
      if (url.pathname === '/') return page({ body: Buffer.from(HOME) });
      if (url.pathname === '/s.css') return page({ contentType: 'text/css', body: Buffer.from('.a{background:#2f7d6b}') });
      await delay(40);
      return page({ body: Buffer.from(`<body><p>${text(3)}</p></body>`) });
    };
    const events = [];
    await readSitePages('doceponto.com.br', { transport, probe: (e) => events.push(`${e.type}:${e.kind}`) });
    const at = (k) => events.indexOf(k);
    expect(at('result:logo')).toBeGreaterThan(-1);
    expect(at('result:colors')).toBeLessThan(at('result:page'));
    expect(at('result:identity')).toBeLessThan(at('result:page'));
    // o tempo do passo "css" é o do download, não o da leitura toda
    expect(at('result:css')).toBeLessThan(at('result:page'));
  });
});
