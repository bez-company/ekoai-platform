// discover.ts: quais páginas do site a Ekoai lê (SPEC 034, BEZ-534). Puro, menos `discoverPages`, que recebe a busca de fora. O site inteiro não cabe numa leitura (tempo, custo
// do modelo, ADR 0030): a descoberta junta o mapa do site (sitemap.xml, com índice de mapas) e os links da página inicial, dá um tipo a cada
// endereço (sobre, produto, preço, blog...) e escolhe um número limitado de páginas, com cota por tipo para o blog não engolir os produtos.
// Só o mesmo site, só https. Os limites abaixo são o ponto de partida; o tempo real por etapa (BEZ-532) é o que os ajusta.

import { FILE_EXT } from './extract';
import { robotsAllows } from './robots';

export type PageKind = 'about' | 'product' | 'service' | 'prices' | 'faq' | 'contact' | 'blog' | 'other';
export type Candidate = { url: string; lastmod?: string | null };

// Páginas lidas além da inicial, as de cada tipo no máximo e quantas leituras de página correm ao mesmo tempo.
export const PAGES_MAX = 12;
export const PAGE_CONCURRENCY = 4;
export const PAGE_TEXT_MAX = 4000;
const SITEMAPS_MAX = 4;
const ENTRIES_MAX = 5000;

// Ordem de valor para escrever posts: o que a empresa é, o que vende e por quanto, depois o resto. A cota é o máximo por tipo na 1ª rodada; sobrando
// lugar, uma 2ª rodada completa com o que restou, sem cota.
const ORDER: PageKind[] = ['about', 'product', 'service', 'prices', 'faq', 'contact', 'blog', 'other'];
const QUOTA: Record<PageKind, number> = { about: 2, product: 4, service: 2, prices: 2, faq: 1, contact: 1, blog: 3, other: 2 };

export const PAGE_LABEL: Record<PageKind, string> = {
  about: 'Lendo a página sobre a empresa',
  product: 'Lendo a página de produtos',
  service: 'Lendo a página de serviços',
  prices: 'Lendo a página de preços e pedidos',
  faq: 'Lendo as perguntas frequentes',
  contact: 'Lendo a página de contato',
  blog: 'Lendo o blog',
  other: 'Lendo uma página do site',
};

const NOISE = /login|entrar|signin|sign-in|cadastr|carrinho|\/cart|checkout|minha-conta|account|politica|privacidade|termos|cookies|lgpd|trabalhe|wp-admin|wp-json|\/feed|\/tag\/|\/tags\/|\/category\/|\/categoria\/|\/author\/|\/autor\/|\/page\/\d|\/amp\b/i;
const KINDS: [PageKind, RegExp][] = [
  ['about', /sobre|quem-somos|empresa|institucional|historia|about/i],
  ['faq', /faq|perguntas|duvidas|ajuda/i],
  ['contact', /contato|fale-conosco|contact|onde-estamos|localizacao|unidades/i],
  ['prices', /preco|valores|planos?\b|orcamento|encomenda|pedido|como-funciona|pricing/i],
  ['service', /servico|solucoes|atuacao|especialidade|tratamento|service|solution/i],
  ['product', /produto|cardapio|menu|loja|catalogo|colecao|shop|store|product/i],
  ['blog', /^\/(?:blog|artigos?|noticias|novidades|dicas|posts?|conteudo)(?:\/|$)/i],
];

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
const pathKey = (u: URL) => u.pathname.replace(/\/+$/, '') || '/';

export function classifyPath(path: string): PageKind {
  const clean = path.toLowerCase();
  // O blog primeiro: "/blog/preco-do-bolo" é artigo, não página de preços.
  const blog = KINDS.find(([k]) => k === 'blog')![1];
  if (blog.test(clean)) return 'blog';
  return KINDS.find(([k, re]) => k !== 'blog' && re.test(clean))?.[0] ?? 'other';
}

// ── mapa do site ──
const decode = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const inner = (block: string, tag: string): string | null => {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  const v = decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  return v || null;
};

export function sitemapsFromRobots(robotsText: string): string[] {
  const out: string[] = [];
  for (const line of robotsText.slice(0, 200_000).split(/\r?\n/)) {
    const m = line.replace(/#.*/, '').match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// `<urlset>` dá as páginas (com a data de mudança, quando há); `<sitemapindex>` dá outros mapas.
export function parseSitemap(xml: string): { pages: Candidate[]; maps: string[] } {
  const body = xml.slice(0, 2 * 1024 * 1024);
  const maps: string[] = [];
  for (const m of body.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = inner(m[1], 'loc');
    if (loc) maps.push(loc);
    if (maps.length === SITEMAPS_MAX * 4) break;
  }
  const pages: Candidate[] = [];
  for (const m of body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = inner(m[1], 'loc');
    if (loc) pages.push({ url: loc, lastmod: inner(m[1], 'lastmod') });
    if (pages.length === ENTRIES_MAX) break;
  }
  return { pages, maps };
}

const time = (s: string | null | undefined): number => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
};

// Escolhe as páginas: só o mesmo site e https, sem a inicial, sem arquivo nem página de conta ou política, sem repetir caminho. Cada tipo ganha a
// sua cota na ordem de valor; o que sobrar de lugar é preenchido com o que restou. Dentro do tipo, o blog vai do mais recente para o mais antigo
// e o resto do caminho mais curto (a página de seção) para o mais longo; empate fica com a ordem de chegada (os links da página inicial vêm antes).
export function pickPages(candidates: Candidate[], home: URL, max = PAGES_MAX): { urls: string[]; kinds: PageKind[]; found: number } {
  const host = hostOf(home);
  const seen = new Set<string>([pathKey(home)]);
  const byKind = new Map<PageKind, { url: string; path: string; order: number; at: number }[]>();
  let found = 0;
  candidates.forEach((c, order) => {
    let u: URL;
    try {
      u = new URL(c.url);
    } catch {
      return;
    }
    if (u.protocol !== 'https:' || hostOf(u) !== host || FILE_EXT.test(u.pathname) || NOISE.test(u.pathname)) return;
    const key = pathKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    found += 1;
    const kind = classifyPath(key);
    if (kind === 'other' && key.split('/').length > 3) return;
    const list = byKind.get(kind) ?? [];
    list.push({ url: `${u.origin}${u.pathname}`, path: key, order, at: time(c.lastmod) });
    byKind.set(kind, list);
  });
  for (const [kind, list] of byKind) list.sort((a, b) => (kind === 'blog' ? b.at - a.at : a.path.length - b.path.length) || a.order - b.order);

  const chosen: { url: string; kind: PageKind }[] = [];
  const used = new Set<string>();
  const take = (kind: PageKind, limit: number) => {
    for (const p of byKind.get(kind) ?? []) {
      if (chosen.length >= max || limit <= 0) return;
      if (used.has(p.url)) continue;
      used.add(p.url);
      chosen.push({ url: p.url, kind });
      limit -= 1;
    }
  };
  for (const kind of ORDER) take(kind, QUOTA[kind]);
  for (const kind of ORDER) take(kind, max);
  return { urls: chosen.map((c) => c.url), kinds: chosen.map((c) => c.kind), found };
}

// ── busca (a busca vem de fora: read.ts a monta com as regras do ADR 0030) ──
export type DiscoverDeps = {
  home: URL;
  robotsText: string;
  agent: string;
  // Texto da resposta ou `null` quando não abriu.
  fetchText: (url: string, accept: string) => Promise<string | null>;
  // Os links da página inicial, já na ordem de valor: entram primeiro e vencem o empate.
  navLinks: string[];
};
export type Discovered = { urls: string[]; kinds: PageKind[]; found: number; usedSitemap: boolean };

const sameSite = (raw: string, home: URL): URL | null => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && hostOf(u) === hostOf(home) ? u : null;
  } catch {
    return null;
  }
};

export async function discoverPages(d: DiscoverDeps): Promise<Discovered> {
  const listed = sitemapsFromRobots(d.robotsText).filter((u) => sameSite(u, d.home) && !/\.gz$/i.test(u));
  const first = listed.length ? listed.slice(0, 2) : [new URL('/sitemap.xml', d.home).toString()];
  const entries: Candidate[] = [];
  const queue = [...first];
  const done = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < SITEMAPS_MAX && entries.length < ENTRIES_MAX) {
    const url = queue.shift()!;
    if (done.has(url)) continue;
    done.add(url);
    fetched += 1;
    const xml = await d.fetchText(url, 'application/xml,text/xml;q=0.9,*/*;q=0.5');
    if (!xml) continue;
    const { pages, maps } = parseSitemap(xml);
    entries.push(...pages);
    // Mapas filhos: os que têm cara de página e de produto primeiro; o de imagem ou de categoria fica para o fim.
    const rank = (m: string) => (/page|pagina|product|produto|post/i.test(m) ? 0 : /image|imagem|categor|tag/i.test(m) ? 2 : 1);
    for (const m of maps.filter((m) => sameSite(m, d.home) && !/\.gz$/i.test(m)).sort((a, b) => rank(a) - rank(b))) queue.push(m);
  }
  const nav: Candidate[] = d.navLinks.map((url) => ({ url }));
  const picked = pickPages([...nav, ...entries], d.home);
  const allowed = picked.urls.map((url, i) => ({ url, kind: picked.kinds[i] })).filter((p) => !d.robotsText || robotsAllows(d.robotsText, new URL(p.url).pathname, d.agent));
  return { urls: allowed.map((p) => p.url), kinds: allowed.map((p) => p.kind), found: picked.found, usedSitemap: entries.length > 0 };
}
