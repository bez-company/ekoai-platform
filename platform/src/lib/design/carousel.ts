// carousel.ts: o carrossel na parte pura (SPEC 023, ADR 0025). Do texto das lâminas aos DesignSpec que o render
// desenha, e as regras do revisor que só existem entre lâminas (capa curta, título que não se repete). Sem I/O.

import type { CopySlide } from '../agents';
import { roleAt, slidePositions, type DesignSpec, type Layout, type PostKind, type Slide, type SlideRole, type Texts } from './model';
import type { Issue } from './review';

export const MAX_COVER_WORDS = 12;

// A família de cada papel: a capa é a foto com título (atmosfera, com o visual) ou o título em destaque; as lâminas
// de item levam o número em destaque; a chamada é o título em destaque com a assinatura.
export function layoutForRole(role: SlideRole, kind: PostKind, hasVisual: boolean): Layout {
  if (role === 'content') return 'lamina-item';
  if (role === 'cover' && kind === 'atmosfera' && hasVisual) return 'foto-titulo';
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

// Um DesignSpec por lâmina, a partir do que as lâminas têm em comum (marca, logo, formato). Só a capa leva o visual.
export function slideSpecs(slides: readonly CopySlide[], common: Omit<DesignSpec, 'layout' | 'texts' | 'visual' | 'slide' | 'kind'> & { kind: PostKind; visual?: DesignSpec['visual'] }): DesignSpec[] {
  const positions = slidePositions(slides.map((_, i) => roleAt(i, slides.length)));
  return slides.map((s, i) => {
    const { visual, ...rest } = common;
    const layout = layoutForRole(s.role, common.kind, !!visual);
    return { ...rest, layout, texts: s.texts, slide: positions[i], ...(i === 0 && visual ? { visual } : {}) };
  });
}

// O que o design guarda de cada lâmina: papel, layout, texto e a chave do PNG. Marca e logo entram na hora de desenhar.
export function storedSlides(specs: readonly DesignSpec[], roles: readonly SlideRole[], pngKeys: readonly string[]): Slide[] {
  return specs.map((spec, i) => ({ role: roles[i], layout: spec.layout, texts: spec.texts as Texts, pngKey: pngKeys[i] }));
}
