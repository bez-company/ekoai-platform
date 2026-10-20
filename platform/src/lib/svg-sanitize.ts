// svg-sanitize.ts: deixa passar só SVG de logo seguro (SPEC 011 R3). Puro, sem I/O.
//
// Por construção, não por lista negra: o arquivo é lido como XML e REESCRITO só com elementos e
// atributos da lista permitida; o resto cai. Sinal claro de arquivo hostil (script, objeto externo,
// manipulador de evento, referência para fora, DOCTYPE/entidade) recusa o arquivo inteiro, com uma
// mensagem que diz o que trocar. Nada de CDATA, DOCTYPE, entidade própria, instrução de
// processamento (só a declaração <?xml ?>), prefixo de namespace desconhecido ou `url()` que não
// aponte para um id do próprio arquivo.

export const SVG_MAX_BYTES = 2 * 1024 * 1024;

const MAX_ELEMENTS = 5000;
const MAX_DEPTH = 32;
const MAX_USE = 200;
const MAX_VALUE = 200_000;

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
  'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feBlend', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode',
  'style',
]);

// Elementos que executam ou buscam coisa de fora: o arquivo é recusado, não limpo.
const HOSTILE = new Set([
  'script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'handler', 'listener',
  'animate', 'animateTransform', 'animateMotion', 'animateColor', 'set', 'image', 'feImage', 'a', 'switch', 'cursor', 'font-face-uri',
]);

const TEXTY = new Set(['text', 'tspan', 'title', 'desc', 'style']);
const HREF_OK = new Set(['use', 'linearGradient', 'radialGradient', 'pattern']);

const ATTRS = new Set([
  'id', 'class', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height', 'points', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'viewBox', 'preserveAspectRatio', 'version',
  'clip-path', 'clip-rule', 'mask', 'filter', 'style', 'text-anchor', 'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'dominant-baseline', 'dx', 'dy', 'patternUnits', 'patternContentUnits', 'patternTransform', 'maskUnits',
  'maskContentUnits', 'clipPathUnits', 'filterUnits', 'primitiveUnits', 'in', 'in2', 'stdDeviation', 'result', 'mode', 'values',
  'type', 'flood-color', 'flood-opacity', 'operator', 'k1', 'k2', 'k3', 'k4', 'display', 'visibility', 'color', 'vector-effect',
  'xml:space', 'href', 'xlink:href', 'xmlns', 'xmlns:xlink',
]);

const NS = { xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink' } as const;

export type SvgResult = { ok: true; svg: string } | { ok: false; error: string };

class Refuse extends Error {}

const refuse = (message: string): never => {
  throw new Refuse(message);
};

// Entidades: só as cinco de XML e referência numérica; o valor é decodificado ANTES de qualquer
// checagem (senão `ur&#108;(` esconderia um `url(`). O resto é entidade própria (XXE, "bilhão de
// risadas") e fica de fora.
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&([^;\s&<]*);?/g, (m, body: string) => {
    if (!m.endsWith(';')) return refuse('O SVG usa uma entidade XML inválida. Exporte o logo de novo.');
    if (body in NAMED) return NAMED[body];
    const num = /^#(?:x([0-9a-fA-F]{1,6})|(\d{1,7}))$/.exec(body);
    if (!num) return refuse('O SVG usa uma entidade XML própria, que não é aceita. Exporte o logo de novo sem entidades.');
    const code = num[1] ? parseInt(num[1], 16) : parseInt(num[2], 10);
    if (code > 0x10ffff || (code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff)) {
      return refuse('O SVG usa um caractere inválido. Exporte o logo de novo.');
    }
    return String.fromCodePoint(code);
  });
}

// Valor de atributo ou CSS: nada de script, dado embutido ou endereço fora do arquivo.
function checkValue(value: string): void {
  if (value.length > MAX_VALUE) refuse('O SVG tem um valor grande demais. Simplifique o desenho e exporte de novo.');
  const flat = value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([\s\S]))/g, (_m, hex: string | undefined, ch: string | undefined) => {
      if (ch !== undefined) return ch;
      const code = parseInt(hex as string, 16);
      return code > 0x10ffff || code === 0 ? ' ' : String.fromCodePoint(code);
    });
  if (/javascript:|vbscript:|data:|expression\s*\(|@import|behavior\s*:|-moz-binding|<script/i.test(flat)) {
    refuse('O SVG tem código ou conteúdo embutido que não é aceito. Exporte o logo só com formas e cores.');
  }
  for (const m of flat.matchAll(/url\(\s*([^)]*)\)/gi)) {
    if (!/^['"]?#[A-Za-z_][\w.:-]*['"]?$/.test(m[1].trim())) {
      refuse('O SVG aponta para um endereço fora do arquivo. Exporte o logo sem imagens ou fontes externas.');
    }
  }
}

type Node = { tag: string; attrs: [string, string][]; children: (Node | string)[] };

const NAME = /[A-Za-z_:][\w:.-]*/y;
const ATTR = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;

function parse(src: string): Node {
  let i = 0;
  let root: Node | null = null;
  let seenRoot = false;
  const stack: { node: Node | null; name: string }[] = [];
  let elements = 0;
  let uses = 0;
  const kept = () => stack.length === 0 || stack.every((s) => s.node);

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt === -1 ? src.length : lt);
    if (text.trim()) {
      if (stack.length === 0) refuse('Arquivo inválido: tem texto fora do desenho.');
      const decoded = decode(text);
      const top = stack[stack.length - 1];
      if (top.node && TEXTY.has(top.node.tag)) top.node.children.push(decoded);
    }
    if (lt === -1) break;

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) refuse('Arquivo inválido: comentário sem fim.');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) refuse('O SVG tem DOCTYPE, entidade ou CDATA, que não são aceitos. Exporte o logo como SVG simples.');
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end < 0) refuse('Arquivo inválido: instrução sem fim.');
      if (!/^xml\s/.test(src.slice(lt + 2, end)) || seenRoot || stack.length) refuse('O SVG tem uma instrução de processamento que não é aceita.');
      i = end + 2;
      continue;
    }

    if (src.startsWith('</', lt)) {
      const m = /^<\/([A-Za-z_:][\w:.-]*)\s*>/.exec(src.slice(lt, lt + 200));
      const top = stack.pop();
      if (!m || !top || top.name !== m[1]) refuse('Arquivo inválido: tags mal fechadas.');
      i = lt + m![0].length;
      continue;
    }

    NAME.lastIndex = lt + 1;
    const nm = NAME.exec(src);
    if (!nm) refuse('Arquivo inválido: tag sem nome.');
    const name = nm![0];
    let pos = NAME.lastIndex;
    const attrs: [string, string][] = [];
    const seen = new Set<string>();
    for (;;) {
      ATTR.lastIndex = pos;
      const am = ATTR.exec(src);
      if (!am) break;
      const key = am[1];
      if (seen.has(key)) refuse('Arquivo inválido: atributo repetido.');
      seen.add(key);
      attrs.push([key, am[2] ?? am[3] ?? '']);
      pos = ATTR.lastIndex;
    }
    const rest = /^\s*(\/?)>/.exec(src.slice(pos, pos + 50));
    if (!rest) refuse('Arquivo inválido: tag mal formada.');
    i = pos + rest![0].length;
    const selfClose = rest![1] === '/';

    if (HOSTILE.has(name)) refuse(`O SVG tem o elemento <${name}>, que executa ou busca algo de fora e não é aceito. Exporte o logo só com formas e cores.`);
    if (stack.length === 0) {
      if (seenRoot) refuse('Arquivo inválido: mais de um elemento na raiz.');
      if (name !== 'svg') refuse('O arquivo não é um SVG (a raiz precisa ser <svg>).');
    }
    seenRoot = true;

    const allowed = ELEMENTS.has(name) && kept();
    let node: Node | null = null;
    if (allowed) {
      elements += 1;
      if (elements > MAX_ELEMENTS) refuse('O SVG tem elementos demais. Simplifique o desenho e exporte de novo.');
      if (name === 'use') uses += 1;
      if (uses > MAX_USE) refuse('O SVG repete elementos demais. Simplifique o desenho e exporte de novo.');
      if (stack.length >= MAX_DEPTH) refuse('O SVG está aninhado demais. Simplifique o desenho e exporte de novo.');
      node = { tag: name, attrs: cleanAttrs(name, attrs), children: [] };
      const parent = stack[stack.length - 1]?.node;
      if (parent) parent.children.push(node);
      else root = node;
    } else {
      // Elemento fora da lista: o galho inteiro cai, mas as regras de recusa valem para o que está dentro.
      for (const [k] of attrs) if (/^on/i.test(k)) refuse('O SVG tem manipulador de evento, que não é aceito.');
    }
    if (!selfClose) stack.push({ node, name });
  }
  if (stack.length) refuse('Arquivo inválido: tags sem fechar.');
  return root ?? refuse('O arquivo não tem um desenho SVG.');
}

function cleanAttrs(tag: string, attrs: [string, string][]): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, raw] of attrs) {
    if (/^on/i.test(key)) refuse('O SVG tem manipulador de evento, que não é aceito.');
    const value = decode(raw);
    if (key === 'xmlns' || key === 'xmlns:xlink') {
      if (value !== NS[key]) refuse('O SVG declara um namespace que não é aceito.');
      continue; // reescrito na saída
    }
    if (key === 'href' || key === 'xlink:href') {
      if (!/^#[A-Za-z_][\w.:-]*$/.test(value)) refuse('O SVG aponta para um endereço fora do arquivo. Exporte o logo sem imagens ou fontes externas.');
      if (HREF_OK.has(tag)) out.push([key, value]);
      continue;
    }
    if (!ATTRS.has(key)) continue; // inkscape:, sodipodi:, data-*: caem sem alarde
    checkValue(value);
    out.push([key, value]);
  }
  return out;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function write(node: Node, isRoot: boolean): string {
  // A raiz sempre declara os dois namespaces: um `xlink:href` em qualquer descendente precisa dele.
  const attrs = isRoot ? [['xmlns', NS.xmlns], ['xmlns:xlink', NS['xmlns:xlink']], ...node.attrs] : node.attrs;
  const open = `<${node.tag}${attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}`;
  if (node.children.length === 0) return `${open}/>`;
  const inner = node.children.map((c) => (typeof c === 'string' ? esc(c).replace(/&quot;/g, '"') : write(c, false))).join('');
  return `${open}>${inner}</${node.tag}>`;
}

function checkStyleText(node: Node): void {
  if (node.tag === 'style') for (const c of node.children) if (typeof c === 'string') checkValue(c);
  for (const c of node.children) if (typeof c !== 'string') checkStyleText(c);
}

export function sanitizeSvg(input: string): SvgResult {
  try {
    const src = input.replace(/^﻿/, '');
    if (src.includes('\0')) refuse('Arquivo inválido: não é um SVG de texto.');
    const root = parse(src);
    checkStyleText(root);
    return { ok: true, svg: write(root, true) };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, error: e.message };
    throw e;
  }
}
