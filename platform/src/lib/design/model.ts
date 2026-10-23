// model.ts: o design de um post (SPEC 012 decisão 1, ADR 0017). Puro. O que a IA gera é só o
// visual; texto, logo e grade são desenhados por código a partir deste objeto, com os tokens da
// marca do perfil. O mesmo DesignSpec gera sempre o mesmo PNG.

import { DEFAULT_BODY, DEFAULT_HEADING, fontOrDefault, type FontFamily } from './fonts';
import { contrast, isHex, mix, untilContrast, type Hex } from './color';

// foto-janela e foto-arco (BEZ-251): a foto da pessoa encaixada no layout da marca, com o texto
// sempre sobre a cor da marca (uso "Dentro do layout da marca" da foto anexada).
export const LAYOUTS = ['lista-numerada', 'titulo-destaque', 'foto-titulo', 'foto-janela', 'foto-arco'] as const;
export type Layout = (typeof LAYOUTS)[number];

export type PostKind = 'informativo' | 'atmosfera';
export type Ratio = '1:1' | '4:5';
export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br';

export const WIDTH = 1080;
export const HEIGHT: Record<Ratio, number> = { '1:1': 1080, '4:5': 1350 };
export const MARGIN = 64;

export type Brand = {
  primary: Hex; // cor principal: fundos cheios e destaques
  accent: Hex; // detalhe (barra, selo)
  ink: Hex; // texto sobre o papel
  paper: Hex; // fundo claro dos posts informativos
  deep: Hex; // a principal escura o bastante para texto branco em corpo (4,5:1)
  fontHeading: FontFamily;
  fontBody: FontFamily;
  handle: string | null; // @ da conta, sem o @
};

export type Texts = { kicker?: string; title: string; sub?: string; items?: string[] };

export type Logo = { dataUri: string; width: number; height: number };

// Cor do texto escolhida no ajuste rápido (SPEC 019). A marca e as cores de fundo vêm do perfil; só o
// texto de cada slot pode ter cor própria, e o revisor mede o contraste sobre o fundo do layout.
export const TEXT_COLOR_KEYS = ['title', 'sub', 'kicker', 'items'] as const;
export type TextColorKey = (typeof TEXT_COLOR_KEYS)[number];
export type TextColors = Partial<Record<TextColorKey, Hex>>;

export type DesignSpec = {
  kind: PostKind;
  ratio: Ratio;
  layout: Layout;
  texts: Texts;
  brand: Brand;
  logo?: Logo | null;
  visual?: { dataUri: string } | null; // foto ou ilustração gerada: foto-titulo, foto-janela e foto-arco
  logoCorner?: LogoCorner;
  logoHidden?: boolean; // esconder o logo neste post (ajuste rápido)
  colors?: TextColors; // cor própria do texto de cada slot (ajuste rápido)
};

export type ProfileLike = {
  colorPrimary: string | null;
  colorAccent: string | null;
  fontHeading: string | null;
  fontBody: string | null;
  instagramHandle: string | null;
};

// Sem marca no perfil, o post sai neutro (ADR 0011): grafite e laranja queimado.
export const NEUTRAL_PRIMARY: Hex = '#1F2937';
export const NEUTRAL_ACCENT: Hex = '#C2410C';

export function brandFromProfile(p: ProfileLike | null): Brand {
  const primary = isHex(p?.colorPrimary) ? p!.colorPrimary!.toUpperCase() : NEUTRAL_PRIMARY;
  const accent = isHex(p?.colorAccent) ? p!.colorAccent!.toUpperCase() : NEUTRAL_ACCENT;
  // Tinta: a principal, se já lê bem sobre o branco; senão, ela escurecida.
  const ink = untilContrast(primary, '#FFFFFF', 7);
  return {
    primary,
    accent,
    ink,
    paper: mix(primary, '#FFFFFF', 0.94),
    deep: untilContrast(primary, '#FFFFFF', 4.5),
    fontHeading: fontOrDefault(p?.fontHeading, DEFAULT_HEADING),
    fontBody: fontOrDefault(p?.fontBody, DEFAULT_BODY),
    handle: p?.instagramHandle ? p.instagramHandle.replace(/^@/, '') : null,
  };
}

export function defaultLayout(kind: PostKind, texts: Texts): Layout {
  if (kind === 'atmosfera') return 'foto-titulo';
  return texts.items && texts.items.length >= 2 ? 'lista-numerada' : 'titulo-destaque';
}

// Foto "dentro do layout da marca": Janela na primeira direção (briefs.direction começa em 1); cada
// "Outra direção" alterna com o Arco.
export function brandPhotoLayout(direction: number): Layout {
  return direction % 2 === 1 ? 'foto-janela' : 'foto-arco';
}

export function isLayout(value: unknown): value is Layout {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

// O design guardado em post_designs.design: só o que não vem do perfil (texto, layout, canto do
// logo e a chave do visual). Marca e logo entram na hora de renderizar.
// `rules`: os ids das regras de marca aplicadas quando o post nasceu (SPEC 019); só para medir e explicar.
export type StoredDesign = { layout: Layout; texts: Texts; logoCorner?: LogoCorner; logoHidden?: boolean; colors?: TextColors; rules?: string[] };

export function storedDesignOf(spec: DesignSpec): StoredDesign {
  return {
    layout: spec.layout,
    texts: spec.texts,
    ...(spec.logoCorner ? { logoCorner: spec.logoCorner } : {}),
    ...(spec.logoHidden ? { logoHidden: true } : {}),
    ...(spec.colors && Object.keys(spec.colors).length ? { colors: spec.colors } : {}),
  };
}

// Canto do logo quando o design não escolheu (o mesmo padrão das famílias em families.ts).
export function defaultCorner(layout: Layout): LogoCorner {
  return layout === 'foto-titulo' ? 'br' : 'bl';
}

// Famílias que servem ao tipo do post e que o conteúdo atual aguenta: lista numerada pede 2 ou mais
// itens; as de foto pedem visual. A troca de layout do ajuste rápido (BEZ-202) lê daqui.
export function compatibleLayouts(kind: PostKind, texts: Texts, hasVisual: boolean): Layout[] {
  if (kind === 'informativo') return texts.items && texts.items.length >= 2 ? ['lista-numerada', 'titulo-destaque'] : ['titulo-destaque'];
  return hasVisual ? ['foto-titulo', 'foto-janela', 'foto-arco'] : [];
}

// Garante que a marca lê bem onde o layout a usa; devolve as cores de texto de cada layout.
// Texto secundário: um pouco mais claro que a tinta, mas nunca abaixo de 4,5:1 sobre o fundo.
function softened(text: Hex, bg: Hex): Hex {
  for (const t of [0.25, 0.15, 0.08]) {
    const candidate = mix(text, bg, t);
    if (contrast(candidate, bg) >= 4.5) return candidate;
  }
  return text;
}

export function paletteFor(spec: DesignSpec) {
  const base = basePalette(spec);
  const own = spec.colors;
  if (!own) return base;
  // A cor de cada texto sobrescreve a do layout; o fundo nunca muda.
  return { ...base, ...Object.fromEntries(TEXT_COLOR_KEYS.filter((k) => isHex(own[k])).map((k) => [k, own[k]!.toUpperCase()])) };
}

function basePalette(spec: DesignSpec) {
  const b = spec.brand;
  if (spec.layout === 'titulo-destaque') {
    const kicker = contrast(b.accent, b.deep) >= 4.5 ? b.accent : softened('#FFFFFF', b.deep);
    return { bg: b.deep, title: '#FFFFFF', sub: softened('#FFFFFF', b.deep), kicker, items: '#FFFFFF' };
  }
  if (spec.layout === 'foto-titulo') return { bg: b.deep, title: '#FFFFFF', sub: '#FFFFFF', kicker: '#FFFFFF', items: '#FFFFFF' };
  if (spec.layout === 'foto-arco') {
    const kicker = contrast(b.accent, b.deep) >= 4.5 ? b.accent : softened('#FFFFFF', b.deep);
    return { bg: b.deep, title: '#FFFFFF', sub: softened('#FFFFFF', b.deep), kicker, items: '#FFFFFF' };
  }
  const kicker = contrast(b.primary, b.paper) >= 4.5 ? b.primary : b.ink;
  return { bg: b.paper, title: b.ink, sub: softened(b.ink, b.paper), kicker, items: b.ink };
}
