// scene.ts: o design como lista de camadas livres (SPEC 027, BEZ-381). Puro e sem node:*, para o Studio (navegador) e o servidor
// desenharem o mesmo SVG com a mesma conta de quebra de linha; o PNG do servidor é a verdade. Uma `scene` guarda só o que a pessoa
// pode mexer: textos, formas e a logo. O fundo do layout (foto, véu, círculos) continua o do motor: `backdrop`, desenhado a cada
// render a partir do design, nunca guardado aqui. Sem `scene`, o post segue como sempre.

import { isHex, type Hex } from './color';
import { FONTS, isFontFamily, type FontFamily } from './font-metrics';
import { escapeXml, wrapLines } from './text';
import type { TextBox } from './review';

export const SCENE_VERSION = 1;
export const MAX_LAYERS = 60;
export const MAX_LAYER_TEXT = 600;
export const LOGO_VARIANTS_SCENE = ['main', 'dark', 'light', 'symbol'] as const;
export type SceneLogoVariant = (typeof LOGO_VARIANTS_SCENE)[number];

// `badge`: o número dentro do círculo da lista numerada, decoração do layout: fora do revisor de texto e das caixas.
export type TextRole = 'title' | 'kicker' | 'sub' | 'item' | 'handle' | 'name' | 'badge';
type Base = { id: string; name: string; x: number; y: number; w: number; rot: number; opacity: number; locked: boolean; hidden: boolean };
export type TextLayer = Base & {
  type: 'text';
  text: string;
  // As linhas como o motor quebrou. Valem enquanto o texto e a largura não mudam: mexer em um dos dois apaga e a conta refaz.
  lines?: string[];
  font: FontFamily;
  size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  color: Hex;
  lineHeight: number; // vezes o tamanho
  letterSpacing: number;
  upper?: boolean;
  role?: TextRole;
  bg?: Hex; // o fundo sob o texto, para o revisor medir contraste
};
export type ShapeLayer = Base & { type: 'shape'; kind: 'rect' | 'ellipse' | 'line'; h: number; fill: Hex; radius: number };
export type LogoLayer = Base & { type: 'logo'; variant: SceneLogoVariant; h: number };
export type SceneLayer = TextLayer | ShapeLayer | LogoLayer;
export type Scene = { v: typeof SCENE_VERSION; bg: Hex; layers: SceneLayer[] };

export type SceneLogos = Partial<Record<SceneLogoVariant, { dataUri: string; width: number; height: number }>>;
export type SceneContext = { width: number; height: number; backdrop: string; logos: SceneLogos };

// ── contas de texto ──────────────────────────────────────────────────────────────────────────────────────────

const widthFactor = (l: Pick<TextLayer, 'font' | 'bold'>) => FONTS[l.font].width * (l.bold ? 1.08 : 1);

export function layerLines(l: TextLayer): string[] {
  // As linhas guardadas só valem enquanto são o texto da camada: quem mexe no texto nunca desenha linha velha.
  if (l.lines?.length && l.lines.join(' ') === l.text) return l.lines;
  const shown = l.upper ? l.text.toUpperCase() : l.text;
  const maxChars = Math.max(4, Math.floor(l.w / (l.size * widthFactor(l)) + 1e-6));
  const lines = wrapLines(shown, maxChars);
  return lines.length ? lines : [''];
}

export const lineStep = (l: TextLayer) => Math.round(l.size * l.lineHeight);
export const layerHeight = (l: SceneLayer): number => (l.type === 'text' ? Math.max(1, layerLines(l).length * lineStep(l)) : l.h);

// Largura da linha mais comprida pela mesma média de largura do motor (a caixa que o revisor confere).
export function textExtent(l: TextLayer): number {
  const f = widthFactor(l);
  return Math.min(l.w, Math.max(...layerLines(l).map((ln) => ln.length * l.size * f + Math.max(0, ln.length - 1) * l.letterSpacing), 0));
}

// ── desenho ──────────────────────────────────────────────────────────────────────────────────────────────────

const n = (v: number) => Math.round(v * 100) / 100;

function layerSvg(l: SceneLayer, ctx: SceneContext): string {
  if (l.hidden || l.opacity <= 0) return '';
  const h = layerHeight(l);
  const move = `translate(${n(l.x)} ${n(l.y)})${l.rot ? ` rotate(${n(l.rot)} ${n(l.w / 2)} ${n(h / 2)})` : ''}`;
  const op = l.opacity < 1 ? ` opacity="${n(l.opacity)}"` : '';
  let body = '';
  if (l.type === 'text') {
    const ax = l.align === 'center' ? l.w / 2 : l.align === 'right' ? l.w : 0;
    const anchor = l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start';
    const ls = l.letterSpacing ? ` letter-spacing="${n(l.letterSpacing)}"` : '';
    body = layerLines(l)
      .map((line, i) => `<text x="${n(ax)}" y="${Math.round(l.size + i * lineStep(l))}" font-size="${l.size}" fill="${l.color}" font-family="${escapeXml(l.font)}" font-weight="${l.bold ? 700 : 400}"${ls} text-anchor="${anchor}">${escapeXml(line)}</text>`)
      .join('');
  } else if (l.type === 'shape') {
    body = l.kind === 'ellipse'
      ? `<ellipse cx="${n(l.w / 2)}" cy="${n(l.h / 2)}" rx="${n(l.w / 2)}" ry="${n(l.h / 2)}" fill="${l.fill}"/>`
      : l.kind === 'line'
        ? `<rect y="${n(l.h / 2 - 3)}" width="${n(l.w)}" height="6" rx="3" fill="${l.fill}"/>`
        : `<rect width="${n(l.w)}" height="${n(l.h)}" rx="${n(l.radius)}" fill="${l.fill}"/>`;
  } else {
    // A logo exatamente como foi enviada: só a imagem, sem placa, moldura nem filtro.
    const logo = ctx.logos[l.variant] ?? ctx.logos.main;
    if (!logo) return '';
    body = `<image href="${logo.dataUri}" width="${n(l.w)}" height="${n(l.h)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<g transform="${move}"${op}>${body}</g>`;
}

export function sceneSvg(scene: Scene, ctx: SceneContext): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.width}" height="${ctx.height}" viewBox="0 0 ${ctx.width} ${ctx.height}">${ctx.backdrop}${scene.layers.map((l) => layerSvg(l, ctx)).join('')}</svg>`;
}

// As famílias de fonte que a cena usa: o render precisa dos arquivos delas.
export const sceneFonts = (scene: Scene): FontFamily[] => [...new Set(scene.layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.font))];

// As caixas de texto para o revisor de layout (margem, tamanho mínimo, contraste, sobreposição). Girar não entra na conta.
export function sceneBoxes(scene: Scene): TextBox[] {
  const used = new Map<string, number>();
  return scene.layers
    .filter((l): l is TextLayer => l.type === 'text' && !l.hidden && l.opacity > 0 && !!l.text.trim() && l.role !== 'badge')
    .map((l) => {
      const base = l.role ?? 'text';
      const k = (used.get(base) ?? 0) + 1;
      used.set(base, k);
      const id = l.role === 'item' || !l.role ? `${base}${k}` : k === 1 ? base : `${base}${k}`;
      return { id, x: l.x + (l.align === 'center' ? (l.w - textExtent(l)) / 2 : l.align === 'right' ? l.w - textExtent(l) : 0), y: l.y, w: textExtent(l), h: layerHeight(l), size: l.size, color: l.color, bg: l.bg ?? scene.bg, bold: l.bold };
    });
}

// ── validação na fronteira ───────────────────────────────────────────────────────────────────────────────────

export type SceneParse = { ok: true; value: Scene } | { ok: false; error: string; field?: string };

const bad = (error: string, field?: string): SceneParse => ({ ok: false, error, field });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const CLEAN_NAME = (v: unknown) => (typeof v === 'string' ? clean(v).slice(0, 60) : '');
const ROLES: readonly TextRole[] = ['title', 'kicker', 'sub', 'item', 'handle', 'name', 'badge'];

export function parseScene(raw: unknown, limits: { width: number; height: number }): SceneParse {
  if (!isObj(raw)) return bad('A cena precisa ser um objeto.', 'scene');
  if (raw.v !== SCENE_VERSION) return bad('Versão da cena desconhecida. Recarregue a página.', 'scene.v');
  if (!isHex(raw.bg)) return bad('A cor de fundo da cena é inválida.', 'scene.bg');
  if (!Array.isArray(raw.layers)) return bad('A cena precisa de uma lista de camadas.', 'scene.layers');
  if (raw.layers.length > MAX_LAYERS) return bad(`No máximo ${MAX_LAYERS} camadas por imagem.`, 'scene.layers');
  const lo = -limits.width, hiX = limits.width * 2, hiY = limits.height * 2;
  const seen = new Set<string>();
  const layers: SceneLayer[] = [];
  for (const [i, r] of raw.layers.entries()) {
    const at = `scene.layers.${i}`;
    if (!isObj(r)) return bad('Camada inválida.', at);
    if (typeof r.id !== 'string' || !ID.test(r.id) || seen.has(r.id)) return bad('Camada com identificador inválido ou repetido.', `${at}.id`);
    seen.add(r.id);
    const x = num(r.x, lo, hiX), y = num(r.y, lo, hiY), w = num(r.w, 1, limits.width * 3), rot = num(r.rot, -360, 360), opacity = num(r.opacity, 0, 1);
    if (x === null || y === null || w === null || rot === null || opacity === null) return bad('Posição, tamanho, giro ou opacidade fora do limite.', at);
    const base = { id: r.id, name: CLEAN_NAME(r.name) || 'Camada', x, y, w, rot, opacity, locked: r.locked === true, hidden: r.hidden === true };
    if (r.type === 'text') {
      if (typeof r.text !== 'string') return bad('O texto precisa ser um texto.', `${at}.text`);
      const text = clean(r.text);
      if (text.length > MAX_LAYER_TEXT) return bad(`O texto passa de ${MAX_LAYER_TEXT} caracteres.`, `${at}.text`);
      if (!isFontFamily(r.font)) return bad('Escolha uma fonte da lista.', `${at}.font`);
      const size = num(r.size, 8, 400), lineHeight = num(r.lineHeight, 0.7, 3), letterSpacing = num(r.letterSpacing, -20, 60);
      if (size === null || lineHeight === null || letterSpacing === null) return bad('Tamanho, entrelinha ou espaço entre letras fora do limite.', at);
      if (r.align !== 'left' && r.align !== 'center' && r.align !== 'right') return bad('Alinhamento inválido.', `${at}.align`);
      if (!isHex(r.color)) return bad('Cor do texto inválida.', `${at}.color`);
      let lines: string[] | undefined;
      if (r.lines !== undefined) {
        if (!Array.isArray(r.lines) || r.lines.length > 20 || r.lines.some((l) => typeof l !== 'string' || l.length > MAX_LAYER_TEXT)) return bad('Linhas inválidas.', `${at}.lines`);
        lines = (r.lines as string[]).map(clean);
      }
      if (r.role !== undefined && !ROLES.includes(r.role as TextRole)) return bad('Papel do texto inválido.', `${at}.role`);
      if (r.bg !== undefined && !isHex(r.bg)) return bad('Cor de fundo do texto inválida.', `${at}.bg`);
      layers.push({ ...base, type: 'text', text, ...(lines ? { lines } : {}), font: r.font, size, bold: r.bold === true, align: r.align, color: r.color, lineHeight, letterSpacing, ...(r.upper === true ? { upper: true } : {}), ...(r.role ? { role: r.role as TextRole } : {}), ...(r.bg ? { bg: r.bg as Hex } : {}) });
    } else if (r.type === 'shape') {
      const h = num(r.h, 1, limits.height * 3), radius = num(r.radius, 0, 1000);
      if (r.kind !== 'rect' && r.kind !== 'ellipse' && r.kind !== 'line') return bad('Forma inválida.', `${at}.kind`);
      if (h === null || radius === null || !isHex(r.fill)) return bad('Forma com medida ou cor inválida.', at);
      layers.push({ ...base, type: 'shape', kind: r.kind, h, fill: r.fill, radius });
    } else if (r.type === 'logo') {
      const h = num(r.h, 1, limits.height * 3);
      if (h === null || !(LOGO_VARIANTS_SCENE as readonly string[]).includes(r.variant as string)) return bad('Logo com medida ou versão inválida.', at);
      layers.push({ ...base, type: 'logo', variant: r.variant as SceneLogoVariant, h });
    } else return bad('Tipo de camada desconhecido.', `${at}.type`);
  }
  return { ok: true, value: { v: SCENE_VERSION, bg: raw.bg, layers } };
}

// O contador de posição que o motor põe no selo das lâminas de item ("2 DE 4"): é paginação, não afirmação. Só vale o texto
// inteiro assim; "3 de 4 clientes recomendam" continua sendo conferido.
const POSITION_COUNTER = /^\s*\d+\s+de\s+\d+\s*$/i;

// O que o revisor de texto lê da cena: os textos à vista, sem o número do círculo da lista nem o contador de lâmina.
// O contador lido como número afirmado barrava o Confirmar de qualquer lâmina de item do carrossel (BEZ-338).
export const sceneTexts = (scene: Scene): string[] =>
  scene.layers.flatMap((l) => (l.type === 'text' && !l.hidden && l.role !== 'badge' && l.text.trim() && !POSITION_COUNTER.test(l.text) ? [l.text] : []));
