// usage-posts-model.ts: a lista de posts do mês e o detalhe de um post em Configurações › Fatura e uso (SPEC 031, entrega 2). A parte
// pura: estado do post, redes na ordem do sistema e o texto de "o que a Ekoai fez". Sem preço nem custo: isso é do console e da fatura.

import { CHANNELS, type Channel } from './types';

export type PostState = 'published' | 'scheduled' | 'to_approve' | 'failed' | 'none';

export const POST_STATE_LABEL: Record<PostState, string> = {
  published: 'Publicado',
  scheduled: 'Agendado',
  to_approve: 'Para aprovar',
  failed: 'Falhou',
  none: 'Sem publicação',
};

const OPEN = new Set(['scheduled', 'queued', 'publishing']);

// O estado do post a partir das publicações das redes e das pendências que ainda esperam aprovação. Uma rede publicada basta para "Publicado".
export function postStateOf(statuses: readonly string[], pendings: number): PostState {
  if (statuses.includes('published')) return 'published';
  if (statuses.some((s) => OPEN.has(s))) return 'scheduled';
  if (pendings > 0) return 'to_approve';
  if (statuses.includes('failed')) return 'failed';
  return 'none';
}

export const CHANNEL_LABEL: Record<Channel, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

// Sem repetir e na ordem do sistema (Instagram, LinkedIn, X), qualquer que seja a ordem de chegada.
export const sortChannels = (list: readonly string[]): Channel[] => CHANNELS.filter((c) => list.includes(c));

// "Instagram", "Instagram e LinkedIn", "Instagram, LinkedIn e X".
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export const TITLE_MAX = 90;
export function postTitle(idea: string): string {
  const clean = idea.replace(/\s+/g, ' ').trim();
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
}

export type PostRow = { id: string; title: string; createdAt: string; channels: Channel[]; state: PostState };
export type PostList = { total: number; rows: PostRow[] };
export const POSTS_PER_PAGE = 20;

export type PostActivity = {
  title: string;
  createdAt: string;
  channels: Channel[];
  state: PostState;
  generatedImages: number; // imagens geradas por modelo; 0 no carrossel do layout da marca
  evaluated: Channel[]; // redes em que o avaliador rodou
  publications: { channel: Channel; status: string }[];
  designEdits: number; // versões de design editadas depois da geração
  fixes: number; // consertos do avaliador (inclui Aplicar sugestão)
};

// O que a Ekoai fez neste post, em frases: texto por rede, imagem, avaliação e publicação. Só o que de fato aconteceu.
export function activityLines(a: PostActivity): string[] {
  const lines: string[] = [];
  if (a.channels.length) lines.push(`Texto ${joinNames(a.channels.map((c) => `do ${CHANNEL_LABEL[c]}`))}${a.channels.length > 1 ? ', cada um para o sinal da rede' : ', para o sinal da rede'}`);
  lines.push(a.generatedImages > 0 ? `${a.generatedImages} ${a.generatedImages === 1 ? 'imagem gerada' : 'imagens geradas'} por modelo` : 'Arte montada no layout da marca, sem imagem gerada');
  if (a.evaluated.length) lines.push(`Avaliação do potencial ${a.evaluated.length > 1 ? 'em cada rede' : `no ${CHANNEL_LABEL[a.evaluated[0]]}`}`);
  const published = sortChannels(a.publications.filter((p) => p.status === 'published').map((p) => p.channel));
  if (published.length) lines.push(`Publicação no ${joinNames(published.map((c) => CHANNEL_LABEL[c]))}`);
  return lines;
}
