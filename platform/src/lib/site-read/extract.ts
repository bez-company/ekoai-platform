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

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}[^)]*\)/g;

function rankColors(html: string, css: string[]): string[] {
  const score = new Map<string, number>();
  const add = (raw: string, weight: number) => {
    const hex = parseColor(raw);
    if (hex && isBrandy(hex)) score.set(hex, (score.get(hex) ?? 0) + weight);
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
