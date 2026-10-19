// Tipos compartilhados — espelham as tabelas do Supabase relevantes pra plataforma.

import type { Utm } from './utm';

export type Channel = 'instagram' | 'linkedin' | 'twitter';

export const CHANNELS: Channel[] = ['instagram', 'linkedin', 'twitter'];

export type Variation = {
  id: number;
  hook?: string;
  body?: string;
  format?: 'single' | 'carousel' | 'thread' | 'pergunta' | 'text';
  // foto-pergunta: a pergunta da arte e o id do croqui da biblioteca
  question?: string;
  sketch?: string;
  slides?: unknown[];
  hashtags?: string[];
  // carrossel renderizado na geração (o Node tem Puppeteer; a plataforma não)
  slideUrls?: string[];
  documentUrl?: string;
};

export type ImageRef = { id: number; url: string | null; path?: string };

// Observabilidade herdada da geração — repassada ao posts no publish.
export type Generation = {
  pillar?: string;
  angle?: string | null;
  variations: Variation[];
  model?: string;
  prompt_hash?: string;
  judge_reason?: string;
  judge_scores?: unknown;
  critic?: unknown;
  guardrail_flags?: string[];
  heuristic_scores?: Record<string, number>;
};

export type PendingApproval = {
  id: string;
  pending_id: string;
  channel: Channel;
  brief_id?: string | null; // ideia da rodada (SPEC 003): redes da mesma ideia compartilham
  generation: Generation;
  top_id?: number;
  images?: ImageRef[];
  seed?: Record<string, unknown>;
  regen_count: number;
  status: string;
  saved_at: string;
};

export type MediaKind = 'image' | 'carousel' | 'text' | 'document' | 'video' | 'thread' | 'story';

export type Campaign = {
  id: string;
  slug: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
};

export type ScheduledStatus = 'scheduled' | 'publishing' | 'published' | 'failed';

export type ScheduledPost = {
  id: string;
  channel: Channel;
  pillar?: string | null;
  angle?: string | null;
  variation: Variation;
  chosen_variation_id?: number | null;
  caption_final: string;
  image_url?: string | null;
  chosen_art_id?: number | null;
  slide_urls?: string[] | null;
  generation?: Generation | null;
  seed?: Record<string, unknown> | null;
  status: ScheduledStatus;
  scheduled_for: string;
  published_at?: string | null;
  post_id?: string | null;
  attempts: number;
  last_error?: string | null;
  source_pending_id?: string | null;
  // distribuição (ADR 0001): vínculos com campanha/brief/ativo e o UTM do link
  asset_id?: string | null;
  brief_id?: string | null;
  campaign_id?: string | null;
  media_kind?: MediaKind | null;
  video_url?: string | null;
  document_url?: string | null;
  utm?: Utm | null;
  approved_at: string;
  created_at: string;
  updated_at: string;
};

export type PublishSlot = {
  id: string;
  channel: Channel;
  weekday: number; // 0=domingo .. 6=sábado
  hour: number;
  minute: number;
  active: boolean;
};

export type PublishedPost = {
  id: string;
  pillar: string;
  angle?: string | null;
  channel: Channel;
  hook?: string | null;
  body?: string | null;
  format?: string | null;
  channels: Record<string, unknown>;
  engagement_score?: number | null;
  // funil de conversão da conta, ligado pelo utm_content (SPEC 004)
  funnel?: { cadastros: number; ativados: number; pagantes: number; atualizado_em?: string } | null;
  published_at?: string | null;
};
