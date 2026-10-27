// model.ts: o design de um post (SPEC 012 decisão 1, ADR 0017). Puro. O que a IA gera é só o
// visual; texto, logo e grade são desenhados por código a partir deste objeto, com os tokens da
// marca do perfil. O mesmo DesignSpec gera sempre o mesmo PNG.

import { DEFAULT_BODY, DEFAULT_HEADING, fontOrDefault, type FontFamily } from './fonts';
import { contrast, isHex, mix, untilContrast, type Hex } from './color';
import type { Background, Element, Place } from '../directives';

// foto-janela e foto-arco (BEZ-251): a foto da pessoa encaixada no layout da marca, com o texto
// sempre sobre a cor da marca (uso "Dentro do layout da marca" da foto anexada).
// marca (SPEC 020): o cartão de marca, fundo liso com logo, nome, @ e uma frase onde o pedido mandar (grade 3x3).
// Só nasce de instrução do pedido; não entra na lista de trocas do ajuste rápido de quem não é dele.
// lamina-item (SPEC 023): a lâmina de conteúdo do carrossel, com o número do item em destaque. Só nasce no carrossel;
// como o cartão de marca, não é opção de troca para os outros posts.
export const LAYOUTS = ['lista-numerada', 'titulo-destaque', 'foto-titulo', 'foto-janela', 'foto-arco', 'marca', 'lamina-item'] as const;
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

// O data URI do visual com o tipo lido dos bytes, não do nome do arquivo: o modelo de imagem devolve
// JPEG ou PNG e guardamos tudo em `.png`. O resvg decodifica pelo tipo declarado, então JPEG rotulado
// como PNG some do render sem erro e o post sai só com o fundo da marca.
export function imageDataUri(bytes: Uint8Array): string {
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  const type = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png';
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}

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
  // Instruções do pedido (SPEC 020), lidas pela família `marca`: fundo liso pela paleta da marca, onde fica cada
  // elemento na grade 3x3 ('off' = tirar) e o nome da empresa a escrever.
  background?: Background;
  placements?: Placements;
  brandName?: string | null;
  slide?: SlidePosition; // a posição da lâmina no carrossel (família lamina-item)
};

export type Placements = Partial<Record<Element, Place | 'off'>>;

// Carrossel (SPEC 023, ADR 0025): o post é uma lista de lâminas dentro do design. A primeira é a capa, a última a
// chamada e as do meio levam um item cada. O que o post guarda no nível de cima (layout, texts, png_key) é o da capa.
export const SLIDE_ROLES = ['cover', 'content', 'cta'] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];
export const MIN_SLIDES = 2;
// 10 é o teto do Instagram para um carrossel (BEZ-373); antes eram 6.
export const MAX_SLIDES = 10;

// O que a pessoa ajusta numa lâmina (SPEC 023): layout, texto, canto do logo e cor do texto, como no post de uma imagem.
export type Slide = { role: SlideRole; layout: Layout; texts: Texts; pngKey?: string; logoCorner?: LogoCorner; logoHidden?: boolean; colors?: TextColors };

// Onde a lâmina está no carrossel: `n` de `of` no total e, nas de conteúdo, o número do item entre os itens.
export type SlidePosition = { n: number; of: number; item?: number; items?: number };

export function slidePositions(roles: readonly SlideRole[]): SlidePosition[] {
  const items = roles.filter((r) => r === 'content').length;
  let item = 0;
  return roles.map((role, i) => ({ n: i + 1, of: roles.length, ...(role === 'content' ? { item: ++item, items } : {}) }));
}

// O papel de cada posição: a primeira é a capa, a última a chamada e as do meio levam um item cada.
export const roleAt = (index: number, count: number): SlideRole => (index === 0 ? 'cover' : index === count - 1 ? 'cta' : 'content');

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
export type StoredDesign = { layout: Layout; texts: Texts; logoCorner?: LogoCorner; logoHidden?: boolean; colors?: TextColors; rules?: string[]; background?: Background; placements?: Placements; brandName?: string; slides?: Slide[] };

export function storedDesignOf(spec: DesignSpec): StoredDesign {
  return {
    layout: spec.layout,
    texts: spec.texts,
    ...(spec.logoCorner ? { logoCorner: spec.logoCorner } : {}),
    ...(spec.logoHidden ? { logoHidden: true } : {}),
    ...(spec.colors && Object.keys(spec.colors).length ? { colors: spec.colors } : {}),
    ...(spec.background ? { background: spec.background } : {}),
    ...(spec.placements && Object.keys(spec.placements).length ? { placements: spec.placements } : {}),
    ...(spec.brandName ? { brandName: spec.brandName } : {}),
  };
}

// Canto do logo quando o design não escolheu (o mesmo padrão das famílias em families.ts).
export function defaultCorner(layout: Layout): LogoCorner {
  return layout === 'foto-titulo' ? 'br' : 'bl';
}

// O fundo liso do cartão de marca, só pela paleta da marca (nunca hex livre): o contraste sai da mesma conta de
// sempre. dark = o tom mais escuro da marca, brand = a cor profunda, light = o papel.
export function markBackground(b: Brand, background: Background | undefined): Hex {
  if (background === 'light') return b.paper;
  if (background === 'brand') return b.deep;
  return untilContrast(mix(b.deep, '#000000', 0.45), '#FFFFFF', 7);
}

// Famílias que servem ao tipo do post e que o conteúdo atual aguenta: lista numerada pede 2 ou mais
// itens; as de foto pedem visual. A troca de layout do ajuste rápido (BEZ-202) lê daqui.
export function compatibleLayouts(kind: PostKind, texts: Texts, hasVisual: boolean, current?: Layout): Layout[] {
  const base: Layout[] = kind === 'informativo' ? (texts.items && texts.items.length >= 2 ? ['lista-numerada', 'titulo-destaque'] : ['titulo-destaque']) : hasVisual ? ['foto-titulo', 'foto-janela', 'foto-arco'] : [];
  // O cartão de marca nasce do pedido: quem já está nele continua nele, mas ele não é opção para os outros posts.
  return current === 'marca' || current === 'lamina-item' ? [...base, current] : base;
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
  // Fundo pedido (SPEC 020) nas famílias de lista e de título: só pela paleta da marca, texto claro no escuro e tinta no claro.
  if ((spec.layout === 'lista-numerada' || spec.layout === 'titulo-destaque') && spec.background) {
    const bg = markBackground(b, spec.background);
    const light = spec.background === 'light';
    const text = light ? b.ink : '#FFFFFF';
    const kicker = light ? (contrast(b.primary, bg) >= 4.5 ? b.primary : b.ink) : contrast(b.accent, bg) >= 4.5 ? b.accent : text;
    return { bg, title: text, sub: softened(text, bg), kicker, items: text };
  }
  if (spec.layout === 'marca') {
    const bg = markBackground(b, spec.background);
    const light = spec.background === 'light';
    const text = light ? b.ink : '#FFFFFF';
    return { bg, title: text, sub: softened(text, bg), kicker: text, items: text };
  }
  if (spec.layout === 'titulo-destaque') {
    const kicker = contrast(b.accent, b.deep) >= 4.5 ? b.accent : softened('#FFFFFF', b.deep);
    return { bg: b.deep, title: '#FFFFFF', sub: softened('#FFFFFF', b.deep), kicker, items: '#FFFFFF' };
  }
  if (spec.layout === 'foto-titulo') return { bg: b.deep, title: '#FFFFFF', sub: '#FFFFFF', kicker: '#FFFFFF', items: '#FFFFFF' };
  if (spec.layout === 'foto-arco') {
    const kicker = contrast(b.accent, b.deep) >= 4.5 ? b.accent : softened('#FFFFFF', b.deep);
    return { bg: b.deep, title: '#FFFFFF', sub: softened('#FFFFFF', b.deep), kicker, items: '#FFFFFF' };
  }
  // Marca escura (grafite, ameixa, azul-marinho: a cor principal já lê 7:1 sobre o branco): o post usa a própria cor da
  // marca como fundo, como o título destaque. Com o papel claro por padrão, o grafite da empresa nunca aparecia (BEZ-368).
  if (isDarkBrand(b)) {
    const kicker = contrast(b.accent, b.deep) >= 4.5 ? b.accent : softened('#FFFFFF', b.deep);
    return { bg: b.deep, title: '#FFFFFF', sub: softened('#FFFFFF', b.deep), kicker, items: '#FFFFFF' };
  }
  const kicker = contrast(b.primary, b.paper) >= 4.5 ? b.primary : b.ink;
  return { bg: b.paper, title: b.ink, sub: softened(b.ink, b.paper), kicker, items: b.ink };
}

// A cor principal é escura a ponto de servir de fundo com texto branco (contraste 7:1 ou mais).
export function isDarkBrand(b: Brand): boolean {
  return contrast(b.primary, '#FFFFFF') >= 7;
}
