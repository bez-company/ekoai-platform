import { describe, it, expect } from 'vitest';
import { extractBrand, parseColor, stylesheetLinks } from '../platform/src/lib/site-read/extract.ts';

const URL_ = new URL('https://www.doceponto.com.br/');

const HTML = `<!doctype html><html lang="pt-BR"><head>
<title>Doce Ponto Confeitaria | Bolos sob encomenda em Marília</title>
<meta name="description" content="Bolos, doces &amp; tortas sob encomenda para festas.">
<meta name="theme-color" content="#b83262">
<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/img/apple.png">
<link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="https://cdn.exemplo.com/fonts.css"><link rel="stylesheet" href="http://inseguro.com/x.css">
<style>:root { --brand-primary: #B83262; --gray: #777; --bg: #fff; } body { font-family: "DM Sans", sans-serif; color: #222 } h1 { font-family: 'Playfair Display', serif }</style>
</head><body><header><img class="site-logo" src="/img/logo.svg" alt="Doce Ponto"></header></body></html>`;

describe('cor', () => {
  it('lê hex de 3, 4, 6 e 8 dígitos e rgb()', () => {
    expect(parseColor('#abc')).toBe('#AABBCC');
    expect(parseColor('#abcd')).toBe('#AABBCC');
    expect(parseColor('#b83262')).toBe('#B83262');
    expect(parseColor('#B8326280')).toBe('#B83262');
    expect(parseColor('rgb(184, 50, 98)')).toBe('#B83262');
    expect(parseColor('rgba(184 50 98 / 0.5)')).toBe('#B83262');
    for (const bad of ['', 'red', '#12', '#12345', 'rgb(300,1,1)', 'hsl(10 20% 30%)']) expect(parseColor(bad), bad).toBeNull();
  });
});

describe('leitura da marca no HTML e no CSS', () => {
  const css = ['.btn { background: #2f7d6b } .btn:hover { background: #2f7d6c } .tag { color: #2F7D6B } a { color: #000 } .x { color: #eee }', '.hero { background: rgb(244, 201, 93) }'];
  const read = extractBrand({ html: HTML, css, url: URL_ });

  it('cor do tema e variável de marca vêm primeiro; cinza, branco e preto ficam de fora; quase iguais se fundem', () => {
    expect(read.colors[0]).toBe('#B83262');
    expect(read.colors).toContain('#2F7D6B');
    expect(read.colors).toContain('#F4C95D');
    expect(read.colors).not.toContain('#2F7D6C');
    for (const neutral of ['#777777', '#FFFFFF', '#222222', '#000000', '#EEEEEE']) expect(read.colors).not.toContain(neutral);
  });

  it('nome, descrição (com entidade decodificada), fontes da lista curada e logo', () => {
    expect(read.name).toBe('Doce Ponto Confeitaria');
    expect(read.description).toBe('Bolos, doces & tortas sob encomenda para festas.');
    expect(read.fonts).toEqual({ heading: 'Playfair Display', body: 'DM Sans' });
    expect(read.logoUrl).toBe('https://www.doceponto.com.br/img/logo.svg');
    expect(read.url).toBe('https://www.doceponto.com.br/');
  });

  it('entidades de acento e de pontuação viram texto', () => {
    const r = extractBrand({ html: '<meta name="description" content="Cacau Show &eacute; a maior rede. Pre&ccedil;o &amp; sabor &#233; &#x41; &Aacute;gua &ndash; ok &unknown; &#0;">', css: [], url: URL_ });
    expect(r.description).toBe('Cacau Show é a maior rede. Preço & sabor é A Água - ok &unknown; &#0;');
  });

  it('no máximo 6 cores', () => {
    const many = Array.from({ length: 12 }, (_, i) => `.c${i} { color: hsl(0 0% 0%); background: rgb(${(i * 20) % 255}, ${200 - i * 10}, ${50 + i * 15}) }`).join('\n');
    expect(extractBrand({ html: '<html></html>', css: [many], url: URL_ }).colors.length).toBeLessThanOrEqual(6);
  });

  it('página sem nada devolve vazio, sem quebrar', () => {
    expect(extractBrand({ html: '', css: [], url: URL_ })).toEqual({ url: 'https://www.doceponto.com.br/', name: null, description: null, colors: [], fonts: { heading: null, body: null }, logoUrl: null });
  });

  it('sem imagem de logo, cai para o ícone e depois para og:image; só https', () => {
    expect(extractBrand({ html: '<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="/f.png">', css: [], url: URL_ }).logoUrl).toBe('https://www.doceponto.com.br/a.png');
    expect(extractBrand({ html: '<meta property="og:image" content="//cdn.x.com/og.jpg">', css: [], url: URL_ }).logoUrl).toBe('https://cdn.x.com/og.jpg');
    expect(extractBrand({ html: '<img src="http://x.com/logo.png"><link rel="icon" href="data:image/png;base64,AAA">', css: [], url: URL_ }).logoUrl).toBeNull();
  });

  it('texto da página não vira instrução: título com markup e tamanho absurdo é cortado', () => {
    const r = extractBrand({ html: `<title>${'a'.repeat(500)}</title><meta name="description" content="${'b'.repeat(1000)}">`, css: [], url: URL_ });
    expect(r.name.length).toBeLessThanOrEqual(80);
    expect(r.description.length).toBeLessThanOrEqual(280);
  });

  it('folhas de estilo: até 3, só https, sem repetir', () => {
    expect(stylesheetLinks(HTML, URL_)).toEqual(['https://www.doceponto.com.br/css/site.css', 'https://cdn.exemplo.com/fonts.css']);
    const many = Array.from({ length: 6 }, (_, i) => `<link rel="stylesheet" href="/${i}.css">`).join('') + '<link rel="stylesheet" href="/0.css">';
    expect(stylesheetLinks(many, URL_)).toHaveLength(3);
  });
});

describe('entrada hostil não trava a leitura', () => {
  it('muitos sinais de abertura e valores longos terminam rápido', () => {
    const html = '<meta '.repeat(20000) + '<style>' + '--a:'.repeat(20000) + '</style>';
    const t = Date.now();
    extractBrand({ html, css: ['{'.repeat(100000)], url: URL_ });
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
