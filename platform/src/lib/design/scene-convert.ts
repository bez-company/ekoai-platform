// scene-convert.ts: do SVG que o motor de layouts desenhou para a cena do Studio (SPEC 027). Cada <text> do layout vira uma camada de
// texto (as linhas seguidas, mesmo estilo, viram uma só) e a <image> da logo vira a camada de logo; o resto (foto, véu, círculos,
// barras) é o fundo do layout e continua sendo do motor. Sem mexer em nada, a cena desenha o mesmo post: as linhas ficam como o motor
// quebrou. Puro: lê só o SVG que o próprio motor escreveu.

import { isFontFamily, FONTS, type FontFamily } from './font-metrics';
import type { Composed } from './families';
import { isHex, type Hex } from './color';
import { SCENE_VERSION, type LogoLayer, type Scene, type SceneLayer, type SceneLogoVariant, type TextLayer, type TextRole } from './scene';

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attrs = (raw: string): Record<string, string> => Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

const NAME: Record<TextRole, string> = { title: 'Título', kicker: 'Selo', sub: 'Subtítulo', item: 'Item', handle: '@ da conta', name: 'Nome da empresa', badge: 'Número' };

type Line = { whole: string; x: number; y: number; size: number; fill: string; family: string; weight: number; anchor: string; ls: number; text: string };

export function backdropOf(svg: string): string {
  const open = svg.indexOf('>', svg.indexOf('<svg'));
  return svg.slice(open + 1, svg.lastIndexOf('</svg>'));
}

export function sceneFromComposed(composed: Composed, opts: { bg: Hex; logoByUri?: ReadonlyMap<string, SceneLogoVariant> }): { scene: Scene; backdrop: string } {
  let svg = composed.svg;
  const lines: Line[] = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = attrs(m[1]);
    lines.push({ whole: m[0], x: Number(a.x), y: Number(a.y), size: Number(a['font-size']), fill: a.fill ?? '#000000', family: a['font-family'] ?? 'Inter', weight: Number(a['font-weight'] ?? 400), anchor: a['text-anchor'] ?? 'start', ls: Number(a['letter-spacing'] ?? 0), text: unescapeXml(m[2]) });
  }
  const groups: Line[][] = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    const p = g?.[g.length - 1];
    const step = p ? l.y - p.y : 0;
    if (p && l.x === p.x && l.size === p.size && l.fill === p.fill && l.family === p.family && l.weight === p.weight && l.anchor === p.anchor && l.ls === p.ls && step >= l.size * 0.8 && step <= l.size * 1.8) g.push(l);
    else groups.push([l]);
  }

  const layers: SceneLayer[] = [];
  const count: Record<string, number> = {};
  groups.forEach((g, gi) => {
    const first = g[0];
    const font: FontFamily = isFontFamily(first.family) ? first.family : 'Inter';
    const bold = first.weight >= 600;
    const factor = FONTS[font].width * (bold ? 1.08 : 1);
    const texts = g.map((l) => l.text);
    const extent = Math.max(first.size, ...texts.map((t) => t.length * first.size * factor + Math.max(0, t.length - 1) * first.ls));
    const x = first.anchor === 'middle' ? first.x - extent / 2 : first.anchor === 'end' ? first.x - extent : first.x;
    const yTop = first.y - first.size;
    const step = g.length > 1 ? g[1].y - g[0].y : Math.round(first.size * 1.1);
    // O papel e o fundo sob o texto vêm da caixa que o motor entregou ao revisor: a mais próxima do canto da camada.
    const box = [...composed.boxes].sort((a, b) => Math.hypot(a.x - x, a.y - yTop) - Math.hypot(b.x - x, b.y - yTop))[0];
    const near = box && Math.hypot(box.x - x, box.y - yTop) < Math.max(40, first.size);
    const role = near ? (box.id.replace(/\d+$/, '') as TextRole) : /^\d{1,2}$/.test(texts.join('')) ? 'badge' : undefined;
    const known = role && role in NAME ? role : undefined;
    const key = known ?? 'text';
    count[key] = (count[key] ?? 0) + 1;
    const layer: TextLayer = {
      id: `t${gi + 1}`,
      type: 'text',
      name: known ? (known === 'item' || known === 'badge' ? `${NAME[known]} ${count[key]}` : NAME[known]) : `Texto ${count[key]}`,
      text: texts.join(' '),
      lines: texts,
      font,
      size: first.size,
      bold,
      align: first.anchor === 'middle' ? 'center' : first.anchor === 'end' ? 'right' : 'left',
      color: isHex(first.fill) ? first.fill : '#000000',
      lineHeight: Math.round((step / first.size) * 1000) / 1000,
      letterSpacing: first.ls,
      x: Math.round(x * 100) / 100,
      y: yTop,
      w: Math.round(extent * 100) / 100,
      rot: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      ...(known ? { role: known } : {}),
      ...(near && isHex(box.bg) ? { bg: box.bg } : {}),
    };
    layers.push(layer);
    for (const l of g) svg = svg.replace(l.whole, '');
  });

  if (opts.logoByUri?.size) {
    for (const m of svg.matchAll(/<image href="([^"]+)" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*\/>/g)) {
      const variant = opts.logoByUri.get(m[1]);
      if (!variant) continue;
      const logo: LogoLayer = { id: 'logo', type: 'logo', name: 'Logo', variant, x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]), rot: 0, opacity: 1, locked: false, hidden: false };
      layers.push(logo);
      svg = svg.replace(m[0], '');
      break;
    }
  }
  return { scene: { v: SCENE_VERSION, bg: opts.bg, layers }, backdrop: backdropOf(svg) };
}
