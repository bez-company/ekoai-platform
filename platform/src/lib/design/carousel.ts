// carousel.ts: o carrossel na parte pura (SPEC 023, ADR 0025). Do texto das lâminas aos DesignSpec que o render
// desenha, e as regras do revisor que só existem entre lâminas (capa curta, título que não se repete). Sem I/O.

import { cleanAltText, type CopySlide } from '../agents';
import { roleAt, slidePositions, type DesignSpec, type Layout, type PostKind, type Slide, type SlideRole, type Texts } from './model';
import type { Issue } from './review';

export const MAX_COVER_WORDS = 12;

// A família de cada papel: a capa é a foto com título (atmosfera, com o visual) ou o título em destaque; as lâminas
// de item levam o número em destaque; a chamada repete a capa (foto com título, ou título em destaque). No atmosfera
// todas as lâminas levam a foto da capa, para o carrossel manter a cara do primeiro post.
export function layoutForRole(role: SlideRole, kind: PostKind, hasVisual: boolean): Layout {
  if (role === 'content') return 'lamina-item';
  if (kind === 'atmosfera' && hasVisual) return 'foto-titulo';
  return 'titulo-destaque';
}

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const plain = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// As regras entre lâminas. A frase diz a lâmina ("Lâmina 3"), porque a pessoa vê as lâminas numeradas.
export function reviewSlides(slides: readonly Pick<CopySlide, 'texts'>[]): Issue[] {
  const issues: Issue[] = [];
  const cover = slides[0]?.texts.title ?? '';
  const words = countWords(cover);
  if (words > MAX_COVER_WORDS) {
    issues.push({ rule: 'cover_long', detail: String(words), message: `Lâmina 1: a capa tem ${words} palavras e o máximo é ${MAX_COVER_WORDS}. Deixe o gancho mais curto.`, where: 'image' });
  }
  const seen = new Map<string, number>();
  slides.forEach((s, i) => {
    const key = plain(s.texts.title);
    if (!key) return;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else issues.push({ rule: 'slide_duplicate', detail: s.texts.title, message: `Lâmina ${i + 1}: repete o título da lâmina ${first + 1}. Cada lâmina diz uma coisa.`, where: 'image' });
  });
  return issues;
}

// Diz de qual lâmina é um achado de texto: a primeira cujo texto tem o trecho do achado. Sem trecho achado (ou achado
// da legenda), fica como veio. Frase que já nomeia a lâmina não é mexida.
export function inSlide(issue: Issue, slides: readonly Pick<CopySlide, 'texts'>[]): Issue {
  if (issue.where !== 'image' || /^Lâmina \d+/.test(issue.message)) return issue;
  const needle = issue.detail.trim().toLowerCase();
  if (!needle) return issue;
  const at = slides.findIndex((s) => [s.texts.kicker, s.texts.title, s.texts.sub].some((t) => t?.toLowerCase().includes(needle)));
  return at < 0 ? issue : { ...issue, message: `Lâmina ${at + 1}: ${issue.message}` };
}

export const inSlideAt = (issue: Issue, index: number): Issue => (/^Lâmina \d+/.test(issue.message) ? issue : { ...issue, message: `Lâmina ${index + 1}: ${issue.message}` });

// Um DesignSpec por lâmina, a partir do que as lâminas têm em comum (marca, logo, formato, fundo). Todas levam o visual
// (a foto da capa, em outro recorte) e a paleta do layout que dá a cara do post (`look`, por padrão o da capa).
export function slideSpecs(slides: readonly CopySlide[], common: Omit<DesignSpec, 'layout' | 'texts' | 'visual' | 'slide' | 'kind'> & { kind: PostKind; visual?: DesignSpec['visual'] }): DesignSpec[] {
  const positions = slidePositions(slides.map((_, i) => roleAt(i, slides.length)));
  return slides.map((s, i) => {
    const { visual, ...rest } = common;
    const layout = layoutForRole(s.role, common.kind, !!visual);
    const look = common.look ?? layoutForRole('cover', common.kind, !!visual);
    return { ...rest, layout, look, texts: s.texts, slide: positions[i], ...(visual ? { visual } : {}) };
  });
}

// O que o design guarda de cada lâmina: papel, layout, texto e a chave do PNG. Marca e logo entram na hora de desenhar.
export function storedSlides(specs: readonly DesignSpec[], roles: readonly SlideRole[], pngKeys: readonly string[]): Slide[] {
  return specs.map((spec, i) => ({
    role: roles[i],
    layout: spec.layout,
    texts: spec.texts as Texts,
    pngKey: pngKeys[i],
    ...(spec.logoCorner ? { logoCorner: spec.logoCorner } : {}),
    ...(spec.logoHidden ? { logoHidden: true } : {}),
    ...(spec.colors && Object.keys(spec.colors).length ? { colors: spec.colors } : {}),
  }));
}

// O texto alternativo de uma lâmina (BEZ-203, estendido ao carrossel): qual lâmina é e o que está escrito nela. Vai no
// container de cada lâmina na Meta; a legenda e o resto do post têm o seu.
export function slideAltText(texts: Texts, index: number, count: number): string {
  const said = [texts.title, texts.sub].filter((x): x is string => !!x).map((x) => x.replace(/\.+$/, '')).join('. ');
  return cleanAltText(`Lâmina ${index + 1} de ${count}: ${said}${/[?!]$/.test(said) ? '' : '.'}`) ?? `Lâmina ${index + 1} de ${count}`;
}

// Os layouts que servem a cada papel (a troca de layout do ajuste rápido lê daqui): a capa é a foto com título (se há
// visual) ou o título em destaque; a lâmina de item, o número em destaque ou o título em destaque; a chamada, como a capa.
export function slideLayouts(role: SlideRole, kind: PostKind, hasVisual: boolean): Layout[] {
  if (role === 'content') return ['lamina-item', 'titulo-destaque'];
  if (kind === 'atmosfera' && hasVisual) return ['foto-titulo', 'titulo-destaque'];
  return ['titulo-destaque'];
}
