// levels.ts: o catálogo do "Criar post" por modelo e qualidade (SPEC 030, protótipo v28). Puro, sem I/O. Define os 3 níveis de
// qualidade (o esforço dos agentes), a vitrine de modelos (ids de estilo), a qualidade da imagem e as regras de imagem por modelo.
// Não há preço aqui: o fluxo do post não mostra valor, que vive na fatura (SPEC 031, decisão de 30/10/2026).

// O banco aceita também 'padrao' e 'pro' (migration 0055), que saíram do seletor em 30/10/2026; nenhum pedido os usa.
export const EFFORTS = ['instantaneo', 'refinado', 'autoral'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'instantaneo';

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

// Os agentes que podem trabalhar num post, na ordem em que aparecem na imagem do esforço.
export const AGENT_NODES = ['Ideia', 'Texto', 'Arte', 'Design', 'Crítica', 'Refino', 'Revisão'] as const;

export type Level = {
  id: Effort;
  name: string;
  // O grau de qualidade em palavras, que a tela mostra no lugar de preço.
  quality: string;
  time: string;
  // Índices de AGENT_NODES dos agentes acesos neste nível.
  lit: number[];
  blurb: string;
  // `quick` roda no worker; `studio` roda no job do estúdio (SPEC 030 F3c) e só fica disponível onde o job existe (levelAvailable).
  engine: 'quick' | 'studio';
  extra?: string;
};

// Nomes provisórios (SPEC 030): o id `instantaneo` é o nome técnico do motor de hoje e aparece na tela como Rápido.
export const LEVELS: readonly Level[] = [
  { id: 'instantaneo', name: 'Rápido', quality: 'Qualidade base', time: 'segundos', lit: [1, 3], blurb: 'Um modelo pronto da marca, preenchido com o texto do seu tema. Sem revisão por agentes; dá para refinar depois.', engine: 'quick' },
  { id: 'refinado', name: 'Refinado', quality: 'Qualidade alta', time: 'cerca de 10 minutos', lit: [0, 1, 2, 3, 4, 6], blurb: 'Ideia, texto, arte e design, com um crítico que aponta o que melhorar e um revisor no fim.', engine: 'studio' },
  { id: 'autoral', name: 'Autoral', quality: 'Qualidade máxima', time: 'cerca de 15 minutos', lit: [0, 1, 2, 3, 4, 5, 6], blurb: 'Layout pensado só para o tema, com crítica, refino e revisão. Entrega 3 opções de design para você escolher.', engine: 'studio', extra: '3 opções' },
];

// O nível da cadeia de agentes só vale onde o job do estúdio existe (STUDIO_JOB_NAME na plataforma); sem ele, aparece como "em breve".
export const levelAvailable = (level: Level, studio: boolean): boolean => level.engine === 'quick' || studio;

export function levelOf(effort: Effort): Level {
  return LEVELS.find((l) => l.id === effort) ?? LEVELS[0];
}

// ── Qualidade da imagem ────────────────────────────────────────────────────────────────────────────────────
export const IMAGE_QUALITIES = ['padrao', 'alta'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'padrao';

export function isImageQuality(value: unknown): value is ImageQuality {
  return typeof value === 'string' && (IMAGE_QUALITIES as readonly string[]).includes(value);
}

export const IMAGE_QUALITY: Record<ImageQuality, { name: string; hint: string; model: string }> = {
  padrao: { name: 'Padrão', hint: 'Boa para a maioria dos posts.', model: 'gemini-3.1-flash-image' },
  alta: { name: 'Alta', hint: 'Mais detalhe e realismo; leva mais tempo.', model: 'gemini-3-pro-image' },
};

// ── Modelos (ids de estilo) ───────────────────────────────────────────────────────────────────────────────────────────────
// Cada estilo é uma direção de design (um território do estúdio). `image`: 'none' = só tipografia e formas, 'optional' = pode ou
// não ter imagem, 'required' = imagem de fundo gerada. É a propriedade que separa minimalista de "com imagem de fundo".
export type StyleImage = 'none' | 'optional' | 'required';
export type Style = { id: string; name: string; image: StyleImage; hint: string };

export const STYLES: readonly Style[] = [
  { id: 'cartaz-tipografico', name: 'Cartaz tipográfico', image: 'none', hint: 'A frase é a imagem.' },
  { id: 'numero-gigante', name: 'Número gigante', image: 'none', hint: 'Um dado grande e uma linha de contexto.' },
  { id: 'citacao-grande', name: 'Citação', image: 'optional', hint: 'Aspas grandes e uma palavra em destaque.' },
  { id: 'mockup-anotado', name: 'Cartão com anotações', image: 'none', hint: 'Um cartão e notas escritas à mão.' },
  { id: 'surreal-fotografico', name: 'Cena surreal', image: 'required', hint: 'Uma imagem inesperada que conta a ideia.' },
  { id: 'objeto-heroi', name: 'Objeto em destaque', image: 'required', hint: 'Um objeto só, com luz de estúdio.' },
  { id: 'cena-cotidiana', name: 'Cena do dia a dia', image: 'required', hint: 'Foto de rotina, com luz natural.' },
  { id: 'capa-de-revista', name: 'Capa de revista', image: 'required', hint: 'Manchete grande sobre uma imagem forte.' },
  { id: 'antes-depois', name: 'Antes e depois', image: 'optional', hint: 'Duas metades que mostram a virada.' },
  { id: 'colagem-editorial', name: 'Colagem', image: 'optional', hint: 'Papel, recortes e camadas.' },
  { id: 'diagrama-didatico', name: 'Diagrama passo a passo', image: 'none', hint: 'Nós e setas que explicam a ideia.' },
  { id: 'bilhete-e-notas', name: 'Bilhete e post-it', image: 'none', hint: 'Mesa de trabalho vista de cima.' },
  { id: 'grade-modular', name: 'Grade de cartões', image: 'none', hint: 'Cartões de tamanhos diferentes num mosaico.' },
  { id: 'cartaz-retro', name: 'Pôster retrô', image: 'none', hint: 'Cores chapadas e meio-tom, como impresso.' },
  { id: 'ilustracao-geometrica', name: 'Ilustração geométrica', image: 'none', hint: 'Formas puras nas cores da marca.' },
];

// O estilo escolhido: o id de um estilo, ou uma das três formas automáticas (a Ekoai escolhe, só entre os minimalistas ou só entre os
// que têm imagem de fundo).
export const AUTO_STYLES = ['auto', 'auto-minimalista', 'auto-imagem'] as const;
export type AutoStyle = (typeof AUTO_STYLES)[number];
export const DEFAULT_STYLE: AutoStyle = 'auto';

export function isStyleChoice(value: unknown): value is string {
  return typeof value === 'string' && ((AUTO_STYLES as readonly string[]).includes(value) || STYLES.some((s) => s.id === value));
}

export type StyleFilter = 'todos' | 'minimalista' | 'imagem';

export function stylesFor(filter: StyleFilter): Style[] {
  if (filter === 'minimalista') return STYLES.filter((s) => s.image !== 'required');
  if (filter === 'imagem') return STYLES.filter((s) => s.image !== 'none');
  return [...STYLES];
}

// O post usa imagem de IA? 'maybe' quando a Ekoai escolhe entre todos os estilos.
export function usesImage(style: string): 'yes' | 'no' | 'maybe' {
  if (style === 'auto') return 'maybe';
  if (style === 'auto-minimalista') return 'no';
  if (style === 'auto-imagem') return 'yes';
  const s = STYLES.find((x) => x.id === style);
  if (!s) return 'maybe';
  return s.image === 'required' ? 'yes' : s.image === 'none' ? 'no' : 'maybe';
}

// O tipo do post que o motor atual conhece (`kind`): minimalista sai do layout da marca (informativo) e com imagem é de atmosfera.
// Estilo que pode ou não ter imagem deixa a Ekoai decidir (null).
export function kindForStyle(style: string): 'informativo' | 'atmosfera' | null {
  const use = usesImage(style);
  return use === 'no' ? 'informativo' : use === 'yes' ? 'atmosfera' : null;
}

// O motivo, em uma frase para a pessoa, de o Refinado ou o Autoral ter saído como Rápido (SPEC 030, decisão 6). O texto técnico fica no log.
export function fallbackReasonFor(technical: string | null | undefined): string {
  const t = (technical ?? '').toLowerCase();
  if (!t) return 'o estúdio não conseguiu concluir a peça';
  if (t.includes('abaixo do mínimo')) return 'a peça ficou abaixo da qualidade mínima';
  if (t.includes('revisor=')) return 'o revisor encontrou defeito no texto ou na marca';
  if (t.includes('layout=')) return 'a peça ficou com defeito de layout';
  if (t.includes('limite') || t.includes('teto')) return 'o custo da peça passou do teto';
  if (t.includes('não está disponível') || t.includes('nao esta disponivel')) return 'o estúdio não está disponível agora';
  return 'o estúdio não conseguiu concluir a peça';
}
