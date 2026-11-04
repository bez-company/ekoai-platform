// learning.ts: vocabulário e validação do feedback e das regras (SPEC 003 R4/R5).
// Puro, sem I/O: serve às rotas de API (fronteira) e aos componentes de cliente.

import { CHANNELS, type Channel } from './types';

export const ASPECTS = ['texto', 'visual', 'tom', 'tema', 'formato', 'cta'] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_LABEL: Record<Aspect, string> = {
  texto: 'Texto',
  visual: 'Visual',
  tom: 'Tom',
  tema: 'Tema',
  formato: 'Formato',
  cta: 'CTA',
};

export type Sentiment = 'negativo' | 'positivo';
export type RuleSource = 'edicao' | 'feedback' | 'manual';

export const SOURCE_LABEL: Record<RuleSource, string> = {
  edicao: 'suas edições',
  feedback: 'seus feedbacks',
  manual: 'manual',
};

export type FeedbackInput = {
  aspect: Aspect;
  sentiment: Sentiment;
  note: string;
  channel: Channel | null; // null = todas as redes
  excerpt: string | null;
  pending_id: string | null;
  scheduled_post_id: string | null;
  post_id: string | null;
};

export type Feedback = FeedbackInput & { id: string; created_at: string };

export type StyleRule = {
  id: string;
  rule: string;
  aspect: Aspect | null;
  channel: Channel | null;
  source: RuleSource;
  active: boolean;
  evidence: { samples?: number; edits?: number; feedback?: number } | null;
  // SPEC 037: null = marca toda; o id = só nos posts daquela campanha, enquanto ela estiver em vigor.
  campaign_id: string | null;
  created_at: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_NOTE = 1000;
const MAX_RULE = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optUuid(v: unknown): string | null {
  const s = str(v);
  return UUID.test(s) ? s : null;
}

function parseChannel(v: unknown): Parsed<Channel | null> {
  if (v == null || v === '' || v === 'todas') return { ok: true, value: null };
  if (CHANNELS.includes(v as Channel)) return { ok: true, value: v as Channel };
  return { ok: false, error: `Rede inválida: use ${CHANNELS.join(', ')} ou todas.` };
}

export function parseFeedbackInput(body: unknown): Parsed<FeedbackInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ASPECTS.includes(b.aspect as Aspect)) {
    return { ok: false, error: 'Escolha o aspecto: texto, visual, tom, tema, formato ou CTA.' };
  }
  const note = str(b.note);
  if (!note) return { ok: false, error: 'Conte o que não funcionou e por quê.' };
  if (note.length > MAX_NOTE) return { ok: false, error: `Resuma em até ${MAX_NOTE} caracteres.` };
  const channel = parseChannel(b.channel);
  if (!channel.ok) return channel;
  return {
    ok: true,
    value: {
      aspect: b.aspect as Aspect,
      sentiment: b.sentiment === 'positivo' ? 'positivo' : 'negativo',
      note,
      channel: channel.value,
      excerpt: str(b.excerpt).slice(0, 200) || null,
      pending_id: str(b.pending_id).slice(0, 100) || null,
      scheduled_post_id: optUuid(b.scheduled_post_id),
      post_id: optUuid(b.post_id),
    },
  };
}

export type RuleInput = { rule: string; aspect: Aspect; channel: Channel | null; campaign_id: string | null };

export function parseRuleInput(body: unknown): Parsed<RuleInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const rule = str(b.rule);
  if (!rule) return { ok: false, error: 'Escreva a regra.' };
  if (rule.length > MAX_RULE) return { ok: false, error: `Regra com até ${MAX_RULE} caracteres.` };
  if (!ASPECTS.includes(b.aspect as Aspect)) return { ok: false, error: 'Escolha o aspecto da regra.' };
  const channel = parseChannel(b.channel);
  if (!channel.ok) return channel;
  // Onde vale (SPEC 037): ausente, vazio ou "marca" = marca toda; senão o id da campanha (a rota confere que é da conta).
  const scope = b.campaign_id;
  if (scope != null && scope !== '' && scope !== 'marca' && !optUuid(scope)) return { ok: false, error: 'Campanha não encontrada. Escolha de novo onde a regra vale.' };
  return { ok: true, value: { rule, aspect: b.aspect as Aspect, channel: channel.value, campaign_id: optUuid(scope) } };
}

// Restaurar uma versão (SPEC 037): o id da regra e o número da versão.
export function parseRestore(body: unknown): Parsed<{ version: number }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const v = Number(b.version);
  if (!Number.isInteger(v) || v < 1) return { ok: false, error: 'Versão não encontrada. Recarregue a página.' };
  return { ok: true, value: { version: v } };
}

// PATCH: liga/desliga e/ou reescreve. Reescrever vira regra manual (o reflect não a desliga).
export function parseRulePatch(body: unknown): Parsed<{ id: string; active?: boolean; input?: RuleInput }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = optUuid(b.id);
  if (!id) return { ok: false, error: 'Regra não encontrada.' };
  const out: { id: string; active?: boolean; input?: RuleInput } = { id };
  if (typeof b.active === 'boolean') out.active = b.active;
  if (b.rule !== undefined) {
    const parsed = parseRuleInput(b);
    if (!parsed.ok) return parsed;
    out.input = parsed.value;
  }
  if (out.active === undefined && !out.input) return { ok: false, error: 'Nada para alterar.' };
  return { ok: true, value: out };
}
