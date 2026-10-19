// utm.ts: UTM de cada distribuição (SPEC 001 R1). O utm_content é o id curto da
// distribuição (scheduled_posts.id); é a chave que liga cadastro e venda do site da conta ao
// post. Puro, sem I/O (testado em tests/utm.test.js). Sem site da conta não há link rastreado:
// nenhuma URL padrão (ADR 0010).

import type { Channel } from './types';

export type Utm = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  url: string;
};

export type LinkPolicy = 'first_comment' | 'reply' | 'bio';

// Campanha padrão quando nenhuma está ativa (rotação de pilares).
export const ALWAYS_ON_CAMPAIGN = 'sempre-on';

// Onde o link entra em cada canal. LinkedIn e X punem link no corpo; no feed do
// Instagram link não é clicável, então vai na bio com o UTM da campanha.
export const LINK_POLICY: Record<Channel, LinkPolicy> = {
  instagram: 'bio',
  linkedin: 'first_comment',
  twitter: 'reply',
};

const SOURCE_BY_CHANNEL: Record<Channel, string> = {
  instagram: 'instagram',
  linkedin: 'linkedin',
  twitter: 'x',
};

export function shortId(uuid: string): string {
  const hex = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (hex.length < 8) throw new Error(`id de distribuição inválido: "${uuid}"`);
  return `d${hex.slice(0, 8)}`;
}

export function withUtm(baseUrl: string, params: Omit<Utm, 'url'>): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', params.source);
  url.searchParams.set('utm_medium', params.medium);
  url.searchParams.set('utm_campaign', params.campaign);
  url.searchParams.set('utm_content', params.content);
  return url.toString();
}

export function distributionUtm(input: {
  channel: Channel;
  distributionId: string;
  campaignSlug?: string | null;
  medium?: string;
  baseUrl?: string | null;
}): Utm | null {
  if (!input.baseUrl) return null;
  const params = {
    source: SOURCE_BY_CHANNEL[input.channel],
    medium: input.medium || 'organico',
    campaign: input.campaignSlug || ALWAYS_ON_CAMPAIGN,
    content: shortId(input.distributionId),
  };
  return { ...params, url: withUtm(input.baseUrl, params) };
}

// Link da bio do Instagram: atribuição por campanha (o feed não tem link por post).
export function bioLink(input: { campaignSlug?: string | null; baseUrl?: string | null } = {}): string | null {
  if (!input.baseUrl) return null;
  return withUtm(input.baseUrl, {
    source: 'instagram',
    medium: 'bio',
    campaign: input.campaignSlug || 'perfil',
    content: 'bio',
  });
}

export function linkCommentText(utm: Utm): string {
  return `Saiba mais: ${utm.url}`;
}
