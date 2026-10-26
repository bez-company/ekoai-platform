// ideas-model.ts: aprovação por ideia (SPEC 003 R3). Agrupa as pendências da mesma rodada,
// diz o papel de cada rede e valida o que a tela manda. Puro: serve às rotas e ao cliente.

import { CHANNELS, type Channel, type PendingApproval } from './types';

export type NetworkRole = 'mother' | 'reuse' | 'own' | 'single';
export type PlanStep = { mode: 'mother' | 'reuse' | 'own' | 'skip' | 'locked'; reason?: string; format?: string };

export type Idea = {
  key: string; // brief_id, ou o pending_id quando a pendência é avulsa
  briefId: string | null;
  pendings: PendingApproval[]; // canal-mãe primeiro
  absent: { channel: Channel; mode: 'skip' | 'locked'; reason?: string }[]; // redes do plano sem pendência
};

export function briefIdOf(p: PendingApproval): string | null {
  const fromSeed = p.seed?.brief_id;
  return p.brief_id || (typeof fromSeed === 'string' ? fromSeed : null);
}

export function roleOf(p: PendingApproval): NetworkRole {
  if ((p.generation as { reuse?: unknown } | undefined)?.reuse) return 'reuse';
  if (p.seed?.mother_channel === p.channel) return 'mother';
  return p.seed?.reuse_plan ? 'own' : 'single';
}

function planOf(p: PendingApproval): Record<string, PlanStep> {
  const plan = p.seed?.reuse_plan;
  return plan && typeof plan === 'object' ? (plan as Record<string, PlanStep>) : {};
}

export function groupIdeas(pendings: PendingApproval[]): Idea[] {
  const map = new Map<string, Idea>();
  for (const p of pendings) {
    const briefId = briefIdOf(p);
    const key = briefId || p.pending_id;
    const idea = map.get(key) || { key, briefId, pendings: [], absent: [] };
    idea.pendings.push(p);
    map.set(key, idea);
  }
  for (const idea of map.values()) {
    idea.pendings.sort((a, b) => Number(roleOf(b) === 'mother') - Number(roleOf(a) === 'mother'));
    const present = new Set(idea.pendings.map((p) => p.channel));
    const plan = planOf(idea.pendings[0]);
    idea.absent = CHANNELS.filter((c) => !present.has(c) && (plan[c]?.mode === 'skip' || plan[c]?.mode === 'locked')).map(
      (c) => ({ channel: c, mode: plan[c].mode as 'skip' | 'locked', reason: plan[c].reason }),
    );
  }
  return [...map.values()];
}

// Post feito pela Ekoai (design) ou foto do banco: a tela do post (PostReview) tem o card Imagem, o Estúdio e o pedido
// de ajuste. A tela por ideia (IdeaForm, SPEC 003) é a das redes e só edita a legenda.
export const hasPostScreen = (p: PendingApproval): boolean => !!p.post_design_id || p.seed?.source === 'photo';

// Para onde a lista Aprovar leva o cartão: o post com design vai para a tela do post, nunca para a tela por ideia.
export function reviewHref(idea: Idea): string {
  const lead = idea.pendings[0];
  if (hasPostScreen(lead) || !idea.briefId) return `/aprovar/${encodeURIComponent(lead.pending_id)}`;
  return `/aprovar/ideia/${encodeURIComponent(idea.briefId)}`;
}

export function motherOf(idea: Idea): PendingApproval | null {
  return idea.pendings.find((p) => roleOf(p) === 'mother') || null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type IdeaItem = {
  pendingId: string;
  enabled: boolean;
  captionId: number;
  artId: number;
  captionText?: string;
  scheduledFor?: string;
  noImage?: boolean;
};

export function parseApproveIdea(body: unknown): Parsed<{ briefId: string; items: IdeaItem[] }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const briefId = typeof b.briefId === 'string' ? b.briefId.trim() : '';
  if (!briefId) return { ok: false, error: 'Ideia não encontrada.' };
  if (!Array.isArray(b.items) || !b.items.length) return { ok: false, error: 'Nenhuma rede nesta ideia.' };
  const items: IdeaItem[] = [];
  for (const raw of b.items as Record<string, unknown>[]) {
    const pendingId = typeof raw?.pendingId === 'string' ? raw.pendingId : '';
    const captionId = Number(raw?.captionId);
    const artId = Number(raw?.artId ?? raw?.captionId);
    if (!pendingId || !Number.isFinite(captionId) || !Number.isFinite(artId)) {
      return { ok: false, error: 'Rede com legenda ou arte inválida. Recarregue a página.' };
    }
    const scheduledFor = typeof raw.scheduledFor === 'string' && raw.scheduledFor ? raw.scheduledFor : undefined;
    if (scheduledFor && Number.isNaN(new Date(scheduledFor).getTime())) {
      return { ok: false, error: 'Horário inválido. Escolha a data de novo.' };
    }
    items.push({
      pendingId,
      enabled: raw.enabled !== false,
      captionId,
      artId,
      captionText: typeof raw.captionText === 'string' ? raw.captionText : undefined,
      scheduledFor,
      noImage: raw.noImage === true,
    });
  }
  if (!items.some((i) => i.enabled)) return { ok: false, error: 'Ligue pelo menos uma rede ou rejeite a ideia.' };
  return { ok: true, value: { briefId, items } };
}

export type ReworkInput = { pendingId: string; mode: 'own' | 'reuse'; sourceVariationId?: number };

export function parseRework(body: unknown): Parsed<ReworkInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const pendingId = typeof b.pendingId === 'string' ? b.pendingId : '';
  if (!pendingId) return { ok: false, error: 'Pendência não encontrada.' };
  if (b.mode !== 'own' && b.mode !== 'reuse') return { ok: false, error: 'Escolha: post próprio ou reaproveitar.' };
  const src = b.sourceVariationId == null ? undefined : Number(b.sourceVariationId);
  if (src !== undefined && !Number.isFinite(src)) return { ok: false, error: 'Variação de origem inválida.' };
  return { ok: true, value: { pendingId, mode: b.mode, sourceVariationId: src } };
}
