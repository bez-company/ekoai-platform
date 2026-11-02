// extract.ts: o que dá para ler da marca numa página (SPEC 033, BEZ-525). Puro: recebe o HTML e as folhas de estilo já baixadas e devolve
// sugestões. O texto lido é dado, nunca instrução. Cores: as que o site declara como tema ou marca valem mais, depois as mais usadas; cinza,
// branco e preto ficam de fora. Sem DOM: o HTML é lido por padrões simples (a entrada tem no máximo 2 MB).

import { BODY_FONTS, HEADING_FONTS } from '../company-profile-model';

export type SiteRead = {
  url: string;
  name: string | null;
  description: string | null;
  colors: string[];
  fonts: { heading: string | null; body: string | null };
  logoUrl: string | null;
};

export const COLORS_MAX = 6;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
const MARKS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', cedil: '\u0327', uml: '\u0308' };
// &eacute; e parentes: letra + acento vira a letra composta (&ccedil; = ç).
const decode = (s: string): string =>
  s
    .replace(/&([a-zA-Z])(acute|grave|circ|tilde|cedil|uml);/g, (m, letter: string, mark: string) => (letter + MARKS[mark]).normalize('NFC'))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    });
const squash = (s: string, max: number): string | null => decode(s).replace(/\s+/g, ' ').trim().slice(0, max) || null;

type Attrs = Record<string, string>;

function attrsOf(tag: string): Attrs {
  const out: Attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const tagsOf = (html: string, name: string): Attrs[] => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrsOf(m[0]));

function meta(html: string, key: string): string | null {
  for (const a of tagsOf(html, 'meta')) if ((a.name ?? a.property ?? '').toLowerCase() === key && a.content) return a.content;
  return null;
}

// ── cor ──
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

export function parseColor(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) return toHex(...([0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)) as [number, number, number]));
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6).toUpperCase()}`;
    return null;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(text);
  if (rgb && [rgb[1], rgb[2], rgb[3]].every((n) => Number(n) <= 255)) return toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  return null;
}

function hsl(hex: string): { s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  return { l, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) };
}

// Cor de marca: com matiz de verdade (não cinza) e nem quase branca nem quase preta.
const isBrandy = (hex: string): boolean => {
  const { s, l } = hsl(hex);
  return s >= 0.2 && l >= 0.1 && l <= 0.92;
};

const distance = (a: string, b: string): number => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));

// Cores que vêm de um framework de CSS e não da marca: a paleta padrão do Bootstrap 3, 4 e 5 e do Material. Um site que só as repete fica sem cor sugerida.
const FRAMEWORK_COLORS = new Set([
  '#007BFF', '#6C757D', '#28A745', '#DC3545', '#FFC107', '#17A2B8', '#0062CC', '#0069D9', '#005CBF', '#545B62', '#218838', '#C82333', '#E0A800', '#138496',
  '#0D6EFD', '#6610F2', '#6F42C1', '#D63384', '#FD7E14', '#198754', '#20C997', '#0DCAF0', '#E83E8C', '#4285F4', '#337AB7', '#5CB85C', '#5BC0DE', '#F0AD4E', '#D9534F',
  // sombras de hover e de alerta do Bootstrap 4
  '#1E7E34', '#117A8B', '#D39E00', '#BD2130', '#B3D7FF', '#004085', '#155724', '#721C24', '#856404', '#0C5460', '#D4EDDA', '#F8D7DA', '#FFF3CD', '#D1ECF1', '#C3E6CB', '#F5C6CB', '#FFEEBA', '#BEE5EB', '#B8DAFF', '#1D2124', '#004085',
  '#2196F3', '#F44336', '#4CAF50', '#FF9800', '#9C27B0', '#E91E63', '#3F51B5', '#009688', '#FFEB3B', '#795548', '#607D8B',
]);

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}[^)]*\)/g;

function rankColors(html: string, css: string[]): string[] {
  const score = new Map<string, number>();
  const add = (raw: string, weight: number) => {
    const hex = parseColor(raw);
    if (hex && isBrandy(hex) && !FRAMEWORK_COLORS.has(hex)) score.set(hex, (score.get(hex) ?? 0) + weight);
  };
  for (const key of ['theme-color', 'msapplication-tilecolor']) {
    const v = meta(html, key);
    if (v) add(v, 60);
  }
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const sheets = [...styles, ...css];
  for (const sheet of sheets) {
    for (const m of sheet.matchAll(/--([\w-]{1,60})\s*:\s*([^;}]{1,80})/g)) {
      const name = m[1].toLowerCase();
      const weight = /primary|brand|marca|principal/.test(name) ? 40 : /accent|secondary|theme|main|destaque/.test(name) ? 25 : 0;
      if (weight) add(m[2], weight);
    }
    // uso comum: cada aparição conta 1, com teto de 20 por cor por folha para uma cor repetida mil vezes não dominar
    const seen = new Map<string, number>();
    for (const m of sheet.matchAll(COLOR_TOKEN)) {
      const hex = parseColor(m[0]);
      if (hex) seen.set(hex, Math.min(20, (seen.get(hex) ?? 0) + 1));
    }
    for (const [hex, n] of seen) add(hex, n);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const picked: string[] = [];
  for (const [hex] of ranked) {
    if (picked.every((p) => distance(p, hex) >= 40)) picked.push(hex);
    if (picked.length === COLORS_MAX) break;
  }
  return picked;
}

// ── fonte ──
// Título ou texto pelo seletor da regra que declara a fonte: h1 a h4, "title" e "heading" contam como título; body, html, p e :root como texto.
const HEADING_SELECTOR = /\bh[1-4]\b|title|heading|titulo/i;
const BODY_SELECTOR = /\bbody\b|\bhtml\b|:root|(^|[\s,>])p\b/i;

function fontsFrom(css: string[], html: string): { heading: string | null; body: string | null } {
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const heading = new Map<string, number>();
  const body = new Map<string, number>();
  const bump = (map: Map<string, number>, family: string) => map.set(family, (map.get(family) ?? 0) + 1);
  for (const sheet of [...styles, ...css]) {
    for (const rule of sheet.matchAll(/([^{}]{1,200})\{([^{}]{1,2000})\}/g)) {
      const family = /font-family\s*:\s*([^;}]{1,200})/i.exec(rule[2])?.[1];
      if (!family) continue;
      const names = family.split(',').map((n) => n.replace(/["']/g, '').replace(/!important/i, '').trim().toLowerCase());
      const target = HEADING_SELECTOR.test(rule[1]) ? heading : BODY_SELECTOR.test(rule[1]) ? body : null;
      if (target) for (const name of names) if (name) bump(target, name);
    }
  }
  const best = (list: readonly string[], used: Map<string, number>) =>
    list.filter((f) => used.has(f.toLowerCase())).sort((x, y) => (used.get(y.toLowerCase()) ?? 0) - (used.get(x.toLowerCase()) ?? 0))[0] ?? null;
  return { heading: best(HEADING_FONTS, heading), body: best(BODY_FONTS, body) };
}

// ── logo, nome, descrição ──
function resolveHttps(href: string | undefined, base: URL): string | null {
  if (!href || /^data:/i.test(href)) return null;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function logoFrom(html: string, base: URL): string | null {
  const head = html.slice(0, 400_000);
  for (const a of tagsOf(head, 'img')) {
    if (/logo/i.test(`${a.src ?? ''} ${a.alt ?? ''} ${a.class ?? ''} ${a.id ?? ''}`)) {
      const url = resolveHttps(a.src, base);
      if (url) return url;
    }
  }
  const links = tagsOf(head, 'link');
  for (const rel of ['apple-touch-icon', 'icon', 'shortcut icon']) {
    const link = links.find((l) => (l.rel ?? '').toLowerCase().split(/\s+/).join(' ') === rel && l.href);
    const url = link && resolveHttps(link.href, base);
    if (url) return url;
  }
  return resolveHttps(meta(head, 'og:image') ?? undefined, base);
}

function nameFrom(html: string): string | null {
  const site = meta(html, 'og:site_name') ?? meta(html, 'application-name');
  if (site) return squash(site, 80);
  const title = /<title[^>]*>([\s\S]{0,1000}?)<\/title>/i.exec(html)?.[1];
  return title ? squash(title.split(/\s[|\-–—:·]\s/)[0], 80) : null;
}

export function stylesheetLinks(html: string, base: URL, max = 3): string[] {
  const out: string[] = [];
  for (const a of tagsOf(html.slice(0, 400_000), 'link')) {
    if (!/stylesheet/i.test(a.rel ?? '') || !a.href) continue;
    const url = resolveHttps(a.href, base);
    if (url && !out.includes(url)) out.push(url);
    if (out.length === max) break;
  }
  return out;
}

export function extractBrand(input: { html: string; css: string[]; url: URL }): SiteRead {
  const { html, css, url } = input;
  return {
    url: url.toString(),
    name: nameFrom(html),
    description: squash(meta(html, 'description') ?? meta(html, 'og:description') ?? '', 280),
    colors: rankColors(html, css),
    fonts: fontsFrom(css, html),
    logoUrl: logoFrom(html, url),
  };
}

// ── texto e páginas internas (BEZ-525b) ──
const TEXT_INPUT_MAX = 400_000;

// O texto que uma pessoa lê na página: sem script, estilo, svg e cabeçalho; uma linha por bloco; até `max` caracteres.
export function visibleText(html: string, max = 6000): string {
  const body = html
    .slice(0, TEXT_INPUT_MAX)
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(?:p|div|br|li|h[1-6]|tr|section|article|header|footer|nav|ul|ol|table|main)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2)
    .join('\n')
    .slice(0, max);
}

const FILE_EXT = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|mp4|mp3|docx?|xlsx?)$/i;
const SKIP_PATH = /login|entrar|signin|sign-in|cadastr|carrinho|cart|checkout|minha-conta|account|politica|privacidade|termos|cookies|lgpd|trabalhe|blog\/.+|wp-admin|wp-json|feed/i;
const PAGE_SCORES: [RegExp, number][] = [
  [/sobre|quem-somos|empresa|institucional|historia|about/i, 5],
  [/produto|cardapio|menu|servico|solucoes|loja|catalogo|colecao|planos/i, 4],
  [/encomenda|pedido|preco|valores|orcamento|como-funciona/i, 3],
  [/contato|fale-conosco|onde-estamos|localizacao/i, 2],
];

// Páginas do mesmo site que mais dizem sobre a empresa (sobre, produtos, encomenda, contato), até `max`, na ordem do que vale mais.
export function internalLinks(html: string, base: URL, max = 3): string[] {
  const host = base.hostname.replace(/^www\./, '');
  const seen = new Set<string>([base.pathname.replace(/\/$/, '') || '/']);
  const found: { url: string; score: number; order: number }[] = [];
  for (const a of tagsOf(html.slice(0, TEXT_INPUT_MAX), 'a')) {
    if (!a.href || /^(?:#|mailto:|tel:|javascript:)/i.test(a.href.trim())) continue;
    const url = resolveHttps(a.href, base);
    if (!url) continue;
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== host || FILE_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) continue;
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (seen.has(path)) continue;
    seen.add(path);
    const score = PAGE_SCORES.find(([re]) => re.test(path))?.[1] ?? 0;
    found.push({ url: `${u.origin}${u.pathname}`, score, order: found.length });
  }
  return found.sort((x, y) => y.score - x.score || x.order - y.order).slice(0, max).map((f) => f.url);
}
