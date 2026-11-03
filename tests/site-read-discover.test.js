import { describe, it, expect } from 'vitest';
import { PAGES_MAX, PAGE_CONCURRENCY, classifyPath, discoverPages, parseSitemap, pickPages, sitemapsFromRobots } from '../platform/src/lib/site-read/discover.ts';
import { readSitePages } from '../platform/src/lib/site-read/read.ts';

const HOME = new URL('https://doceponto.com.br/');
const urls = (paths, host = 'https://doceponto.com.br') => paths.map((p) => ({ url: `${host}${p}` }));
const path = (u) => new URL(u).pathname;

describe('mapa do site', () => {
  it('lê as páginas com a data de mudança, desfaz entidades e CDATA', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://doceponto.com.br/sobre</loc><lastmod>2026-10-01</lastmod></url>
      <url><loc><![CDATA[https://doceponto.com.br/cardapio?a=1&amp;b=2]]></loc></url>
      <url><loc>  https://doceponto.com.br/contato  </loc><lastmod></lastmod></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({
      pages: [
        { url: 'https://doceponto.com.br/sobre', lastmod: '2026-10-01' },
        { url: 'https://doceponto.com.br/cardapio?a=1&b=2', lastmod: null },
        { url: 'https://doceponto.com.br/contato', lastmod: null },
      ],
      maps: [],
    });
  });

  it('índice de mapas devolve os mapas filhos; lixo devolve vazio', () => {
    const xml = '<sitemapindex><sitemap><loc>https://doceponto.com.br/post-sitemap.xml</loc></sitemap><sitemap><loc>https://doceponto.com.br/page-sitemap.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemap(xml)).toEqual({ pages: [], maps: ['https://doceponto.com.br/post-sitemap.xml', 'https://doceponto.com.br/page-sitemap.xml'] });
    expect(parseSitemap('<html>não é mapa</html>')).toEqual({ pages: [], maps: [] });
  });

  it('acha os mapas citados no robots.txt, sem repetir e ignorando comentário', () => {
    const robots = 'User-agent: *\nDisallow: /x\nSitemap: https://doceponto.com.br/a.xml\n# Sitemap: https://doceponto.com.br/comentado.xml\nsitemap: https://doceponto.com.br/b.xml\nSitemap: https://doceponto.com.br/a.xml';
    expect(sitemapsFromRobots(robots)).toEqual(['https://doceponto.com.br/a.xml', 'https://doceponto.com.br/b.xml']);
  });
});

describe('tipo da página', () => {
  it('dá o tipo pelo caminho, e o blog vence ("/blog/preco-do-bolo" é artigo)', () => {
    const cases = {
      '/sobre': 'about', '/quem-somos': 'about', '/cardapio': 'product', '/produtos/bolo-de-pote': 'product', '/servicos': 'service',
      '/encomendas': 'prices', '/planos': 'prices', '/perguntas-frequentes': 'faq', '/contato': 'contact', '/blog/preco-do-bolo': 'blog',
      '/blog': 'blog', '/dicas/festa': 'blog', '/promocoes': 'other', '/': 'other',
    };
    for (const [p, kind] of Object.entries(cases)) expect(classifyPath(p), p).toBe(kind);
  });
});

describe('escolher as páginas', () => {
  it('só o mesmo site em https, sem a inicial, sem arquivo nem conta nem política, sem repetir caminho', () => {
    const { urls: got, found } = pickPages(
      [
        ...urls(['/', '/sobre', '/sobre/', '/logo.png', '/login', '/politica-de-privacidade', '/carrinho', '/tag/bolo', '/cardapio']),
        { url: 'http://doceponto.com.br/contato' },
        { url: 'https://www.doceponto.com.br/encomendas' },
        { url: 'https://outro.com.br/sobre' },
        { url: 'não é url' },
      ],
      HOME,
    );
    expect(got.map(path).sort()).toEqual(['/cardapio', '/encomendas', '/sobre']);
    expect(found).toBe(3);
  });

  it('o blog não engole o resto: cota de 3, e o mais recente primeiro', () => {
    const blog = Array.from({ length: 10 }, (_, i) => ({ url: `https://doceponto.com.br/blog/post-${i}`, lastmod: `2026-0${(i % 9) + 1}-15` }));
    const { urls: got, kinds } = pickPages([...blog, ...urls(['/sobre', '/cardapio', '/encomendas', '/contato'])], HOME);
    expect(kinds.filter((k) => k === 'blog').length).toBeGreaterThanOrEqual(3);
    expect(got.slice(0, 4).map(path)).toEqual(['/sobre', '/cardapio', '/encomendas', '/contato']);
    const blogPaths = got.filter((u) => path(u).startsWith('/blog/')).map(path);
    // ordem por data: post-8 (2026-09), post-7 (08), post-6 (07)...
    expect(blogPaths.slice(0, 3)).toEqual(['/blog/post-8', '/blog/post-7', '/blog/post-6']);
  });

  it('respeita o máximo e completa com o que sobrou quando falta página de outros tipos', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ url: `https://doceponto.com.br/blog/artigo-${i}`, lastmod: null }));
    const { urls: got } = pickPages(many, HOME);
    expect(got).toHaveLength(PAGES_MAX);
    const { urls: few } = pickPages(urls(['/sobre']), HOME);
    expect(few.map(path)).toEqual(['/sobre']);
  });

  it('as cotas por tipo valem na 1ª rodada: 4 produtos, 2 sobre', () => {
    const { urls: got, kinds } = pickPages(urls(['/produtos/a', '/produtos/b', '/produtos/c', '/produtos/d', '/produtos/e', '/sobre', '/empresa', '/historia-da-empresa']), HOME, 6);
    expect(kinds).toEqual(['about', 'about', 'product', 'product', 'product', 'product']);
    expect(got).toHaveLength(6);
  });

  it('links da página inicial vencem o empate com o mapa; página funda demais de tipo "other" não entra', () => {
    const { urls: got } = pickPages([...urls(['/loja']), ...urls(['/produtos']), ...urls(['/a/b/c/d/e'])], HOME);
    expect(got.map(path)).toEqual(['/loja', '/produtos']);
  });
});

describe('descobrir as páginas', () => {
  const deps = (map, over = {}) => ({ home: HOME, robotsText: '', agent: 'ekoaibot', navLinks: [], fetchText: async (u) => map[new URL(u).pathname] ?? null, ...over });
  const set = (...paths) => `<urlset>${paths.map((p) => `<url><loc>https://doceponto.com.br${p}</loc></url>`).join('')}</urlset>`;

  it('sem robots.txt tenta /sitemap.xml', async () => {
    const out = await discoverPages(deps({ '/sitemap.xml': set('/sobre', '/cardapio') }));
    expect(out.usedSitemap).toBe(true);
    expect(out.urls.map(path)).toEqual(['/sobre', '/cardapio']);
    expect(out.found).toBe(2);
  });

  it('segue o índice de mapas até 4 mapas, mapa de página primeiro, e ignora mapa de outro site', async () => {
    const index = '<sitemapindex><sitemap><loc>https://doceponto.com.br/image-sitemap.xml</loc></sitemap><sitemap><loc>https://doceponto.com.br/page-sitemap.xml</loc></sitemap><sitemap><loc>https://intruso.com/x.xml</loc></sitemap></sitemapindex>';
    const asked = [];
    const out = await discoverPages(
      deps({ '/sitemap.xml': index, '/page-sitemap.xml': set('/sobre'), '/image-sitemap.xml': set('/contato') }, { fetchText: async (u) => (asked.push(path(u)), { '/sitemap.xml': index, '/page-sitemap.xml': set('/sobre'), '/image-sitemap.xml': set('/contato') }[path(u)] ?? null) }),
    );
    expect(asked).toEqual(['/sitemap.xml', '/page-sitemap.xml', '/image-sitemap.xml']);
    expect(out.urls.map(path).sort()).toEqual(['/contato', '/sobre']);
  });

  it('usa o mapa que o robots.txt cita e ignora .gz e mapa de outro site', async () => {
    const asked = [];
    await discoverPages(deps({}, { robotsText: 'Sitemap: https://doceponto.com.br/mapa.xml\nSitemap: https://doceponto.com.br/mapa.xml.gz\nSitemap: https://intruso.com/m.xml', fetchText: async (u) => (asked.push(path(u)), null) }));
    expect(asked).toEqual(['/mapa.xml']);
  });

  it('sem mapa (404) cai nos links da página inicial', async () => {
    const out = await discoverPages(deps({}, { navLinks: ['https://doceponto.com.br/sobre', 'https://doceponto.com.br/produtos'] }));
    expect(out.usedSitemap).toBe(false);
    expect(out.urls.map(path)).toEqual(['/sobre', '/produtos']);
  });

  it('tira o que o robots.txt proíbe', async () => {
    const robots = 'User-agent: *\nDisallow: /encomendas';
    const out = await discoverPages(deps({ '/sitemap.xml': set('/sobre', '/encomendas') }, { robotsText: robots }));
    expect(out.urls.map(path)).toEqual(['/sobre']);
  });
});

describe('leitura do site inteiro', () => {
  const page = (body) => ({ status: 200, location: null, contentType: 'text/html', body: Buffer.from(body) });
  const xml = (body) => ({ status: 200, location: null, contentType: 'application/xml', body: Buffer.from(body) });
  const TEXT = 'Bolos e doces feitos à mão para a sua festa em Marília. '.repeat(4);

  it('lê o mapa, escolhe por tipo, lê várias páginas ao mesmo tempo (no máximo 4) e avisa cada passo', async () => {
    let active = 0;
    let peak = 0;
    const sitemap = `<urlset>${['/sobre', '/cardapio', '/encomendas', '/contato', ...Array.from({ length: 8 }, (_, i) => `/blog/post-${i}`)].map((p) => `<url><loc>https://doceponto.com.br${p}</loc></url>`).join('')}</urlset>`;
    const transport = async (url) => {
      if (url.pathname === '/robots.txt') return { status: 404, location: null, contentType: 'text/plain', body: Buffer.from('') };
      if (url.pathname === '/sitemap.xml') return xml(sitemap);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      return page(`<html><head><title>Doce Ponto</title></head><body><p>${TEXT}</p>${url.pathname === '/' ? '<a href="/sobre">s</a>' : ''}</body></html>`);
    };
    const events = [];
    const { pages } = await readSitePages('doceponto.com.br', { transport, probe: (e) => events.push(e) });
    expect(pages.length).toBeGreaterThan(4);
    expect(pages.length).toBeLessThanOrEqual(PAGES_MAX + 1);
    expect(peak).toBeLessThanOrEqual(PAGE_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    const sm = events.find((e) => e.type === 'result' && e.kind === 'sitemap');
    expect(sm).toMatchObject({ found: 12, chosen: PAGES_MAX });
    const labels = events.filter((e) => e.type === 'started' && e.kind === 'page').map((e) => e.label);
    expect(labels).toContain('Lendo a página sobre a empresa');
    expect(labels).toContain('Lendo o blog');
  });
});
