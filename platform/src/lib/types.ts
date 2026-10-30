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
  signal?: 'enviar' | 'salvar' | 'responder' | 'assistir'; // o que o post pede à pessoa (SPEC 028)
  share_reason?: string; // quem faz a ação e por quê, em uma frase
  variations: Variation[];
  model?: string;
  prompt_hash?: string;
  judge_reason?: string;
  judge_scores?: unknown;
  critic?: unknown; // a avaliação de sinais da rede (SPEC 028), lida por criticFromStored
  guardrail_flags?: string[];
  heuristic_scores?: Record<string, number>;
  alt_text?: string; // texto alternativo da imagem, enviado ao Instagram (BEZ-203)
  slide_alts?: string[]; // o de cada lâmina do carrossel, na ordem das lâminas (SPEC 023)
  directives?: GenerationDirectives; // o que a pessoa pediu sobre a imagem e o que o código fez (SPEC 020)
  studio?: { engine?: string; effort?: string; territory?: string; selected?: number; options?: { url: string; score: number | null }[]; marks?: { has: { logo: boolean; handle: boolean }; show: { logo: boolean; handle: boolean }; urls: Record<string, string> } }; // as opções de design do estúdio (SPEC 030, F4)
  studio_fallback?: { from: 'refinado' | 'autoral'; reason: string | null }; // pediu o estúdio e saiu como Rápido (BEZ-497)
};

// `items` está na ordem do pedido; `applied` e `notApplied` ficam por compatibilidade com posts anteriores.
export type GenerationDirectives = {
  status: 'ok' | 'failed';
  read?: string[];
  items?: { text: string; ok: boolean; why?: string }[];
  applied?: string[];
  notApplied?: { what: string; why: string }[];
};

export type PendingApproval = {
  id: string;
  pending_id: string;
  channel: Channel;
  brief_id?: string | null; // ideia da rodada (SPEC 003): redes da mesma ideia compartilham
  post_design_id?: string | null; // post feito pela Ekoai (SPEC 012): o design que re-renderiza sem IA
  post_kind?: 'informativo' | 'atmosfera' | null;
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

// queued: aprovado sem horário livre na agenda; ganha horário quando a conta cria um (scheduleQueued).
export type ScheduledStatus = 'queued' | 'scheduled' | 'publishing' | 'published' | 'failed';

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
  scheduled_for: string | null; // null enquanto está na fila (queued)
  published_at?: string | null;
  post_id?: string | null;
  attempts: number;
  last_error?: string | null;
  // lease da publicação (migration 0036): a tentativa em curso, quando começou e o container da Meta
  attempt_id?: string | null;
  publishing_started_at?: string | null;
  meta_container_id?: string | null;
  source_pending_id?: string | null;
  // distribuição (ADR 0001): vínculos com campanha/brief/ativo e o UTM do link
  asset_id?: string | null;
  // foto do banco de imagens (BEZ-198): marcada como usada quando o post sai
  media_asset_id?: string | null;
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
