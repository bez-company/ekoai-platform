// material-request-model.ts: o pedido de material da Ekoai (SPEC 036, BEZ-549). Puro, sem I/O: decide, depois da rodada
// do coordenador, se vale pedir uma foto real que o banco não tem ou a confirmação de um fato que vence logo, e lê as
// respostas na fronteira das rotas. Quem pede é esta regra, nunca o modelo. Pouco e com prazo: no máximo 2 abertos por
// conta, 1 novo por rodada, o mesmo pedido pausado 14 dias depois de "Não tenho agora" ou de vencer.

import { factStanding, type CompanyFact, type FactCategory } from './company-facts-model';
import { fmtDateTime } from './format';
import { MEDIA_TAGS, TAG_LABEL, type MediaTag } from './media-asset-model';
import { GOALS, type PostGoal } from './post-goals';

export const MATERIAL_KINDS = ['photo', 'confirm'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export const MATERIAL_STATUSES = ['open', 'answered', 'dismissed', 'expired'] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export type MaterialOutcome = 'photo' | 'kept' | 'edited' | 'off' | 'dismissed' | 'expired';

export const OPEN_MAX = 2;
export const PAUSE_DAYS = 14;
export const REMIND_HOURS = 24;
const DAY = 86_400_000;
const TITLE_MAX = 160;
const REASON_MAX = 240;

// A etiqueta do banco que o objetivo pede. Objetivo sem foto real típica (ensinar, promoção, conversa) não pede foto.
const GOAL_TAG: Partial<Record<PostGoal, MediaTag>> = { produto: 'produto', bastidores: 'bastidor', prova_social: 'cliente' };
// Fato que um post de campanha costuma afirmar e que vence: preço e prazo.
const CONFIRM_CATEGORIES: readonly FactCategory[] = ['oferta_preco', 'prazo_horario'];

export type MaterialRequest = {
  id: string;
  kind: MaterialKind;
  status: MaterialStatus;
  needTag: MediaTag | null;
  factId: string | null;
  campaignId: string | null;
  suggestionId: string | null;
  title: string;
  reason: string;
  dueAt: string;
  remindedAt: string | null;
  answeredAt: string | null;
  outcome: MaterialOutcome | null;
  createdAt: string;
};

export function requestFromRow(r: Record<string, unknown>): MaterialRequest {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: String(r.id),
    kind: r.kind as MaterialKind,
    status: r.status as MaterialStatus,
    needTag: (r.need_tag as MediaTag | null) ?? null,
    factId: (r.fact_id as string | null) ?? null,
    campaignId: (r.campaign_id as string | null) ?? null,
    suggestionId: (r.suggestion_id as string | null) ?? null,
    title: String(r.title),
    reason: String(r.reason),
    dueAt: iso(r.due_at)!,
    remindedAt: iso(r.reminded_at),
    answeredAt: iso(r.answered_at),
    outcome: (r.outcome as MaterialOutcome | null) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export type PlanSuggestion = { id: string; slotAt: string; goal: PostGoal; idea: string; assetId: string | null; campaignId: string | null };
export type BankPhoto = { tags: readonly MediaTag[]; suggestable: boolean };
export type PastRequest = Pick<MaterialRequest, 'kind' | 'status' | 'needTag' | 'factId' | 'createdAt' | 'answeredAt'>;

export type MaterialAsk = {
  kind: MaterialKind;
  needTag: MediaTag | null;
  factId: string | null;
  campaignId: string | null;
  suggestionId: string;
  title: string;
  reason: string;
  dueAt: string;
};

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const when = (iso: string) => fmtDateTime(iso).replace(' · ', ' às ');
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

// Pedido igual (mesma etiqueta ou mesmo fato) aberto, ou fechado sem resposta há menos de 14 dias: não pede de novo.
function paused(past: readonly PastRequest[], kind: MaterialKind, key: string, nowMs: number): boolean {
  return past.some((p) => {
    if (p.kind !== kind || (kind === 'photo' ? p.needTag : p.factId) !== key) return false;
    if (p.status === 'open') return true;
    if (p.status === 'dismissed' || p.status === 'expired') return nowMs - Date.parse(p.answeredAt ?? p.createdAt) < PAUSE_DAYS * DAY;
    return false;
  });
}

function photoAsk(s: PlanSuggestion, tag: MediaTag): MaterialAsk {
  const of = s.campaignId ? 'O post da campanha' : 'O post';
  return {
    kind: 'photo',
    needTag: tag,
    factId: null,
    campaignId: s.campaignId,
    suggestionId: s.id,
    title: cut(`Fotos para o post "${s.idea}"`, TITLE_MAX),
    reason: cut(`${of} de ${when(s.slotAt)} é de ${GOALS[s.goal].label.toLowerCase()} e o banco não tem foto de ${TAG_LABEL[tag].toLowerCase()}. Com foto real, o post mostra o que a pessoa vai encontrar.`, REASON_MAX),
    dueAt: s.slotAt,
  };
}

function confirmAsk(s: PlanSuggestion, f: CompanyFact): MaterialAsk {
  return {
    kind: 'confirm',
    needTag: null,
    factId: f.id,
    campaignId: s.campaignId,
    suggestionId: s.id,
    title: cut(`"${f.text}" continua valendo?`, TITLE_MAX),
    reason: cut(`O post da campanha de ${when(s.slotAt)} pode usar este fato, e ele vence em ${dm(f.validUntil!)}.`, REASON_MAX),
    dueAt: s.slotAt,
  };
}

// O pedido desta rodada, ou null. Ordem: foto para post de campanha, confirmação de fato da campanha, foto para os outros.
export function materialAsk(input: {
  now: Date;
  today: string;
  suggestions: readonly PlanSuggestion[];
  photos: readonly BankPhoto[];
  facts: readonly CompanyFact[];
  past: readonly PastRequest[];
}): MaterialAsk | null {
  const nowMs = input.now.getTime();
  if (input.past.filter((p) => p.status === 'open').length >= OPEN_MAX) return null;
  const ahead = [...input.suggestions].filter((s) => Date.parse(s.slotAt) > nowMs).sort((a, b) => Date.parse(a.slotAt) - Date.parse(b.slotAt));
  const hasPhoto = (tag: MediaTag) => input.photos.some((p) => p.suggestable && p.tags.includes(tag));
  const photoFor = (s: PlanSuggestion): MaterialAsk | null => {
    const tag = GOAL_TAG[s.goal];
    if (!tag || s.assetId || hasPhoto(tag) || paused(input.past, 'photo', tag, nowMs)) return null;
    return photoAsk(s, tag);
  };

  for (const s of ahead.filter((x) => x.campaignId)) {
    const ask = photoFor(s);
    if (ask) return ask;
  }
  const firstCampaign = ahead.find((x) => x.campaignId);
  if (firstCampaign) {
    const fact = input.facts.find(
      (f) => f.kind === 'fact' && f.active && f.status === 'confirmed' && CONFIRM_CATEGORIES.includes(f.category) && factStanding(f, input.today).state === 'soon' && !paused(input.past, 'confirm', f.id, nowMs),
    );
    if (fact) return confirmAsk(firstCampaign, fact);
  }
  for (const s of ahead.filter((x) => !x.campaignId)) {
    const ask = photoFor(s);
    if (ask) return ask;
  }
  return null;
}

// Lembrete: um só, quando falta até 24 h e o pedido ainda está aberto.
export function needsReminder(r: Pick<MaterialRequest, 'status' | 'dueAt' | 'remindedAt'>, now: Date): boolean {
  const left = Date.parse(r.dueAt) - now.getTime();
  return r.status === 'open' && !r.remindedAt && left > 0 && left <= REMIND_HOURS * 3_600_000;
}

// ── Fronteira: o corpo das rotas ───────────────────────────────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj = (b: unknown): Record<string, unknown> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export const isRequestId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);

export const PHOTOS_PER_ANSWER = 4;

// Até 4 fotos por resposta (as do envio ou as escolhidas no banco), sem repetir.
export function parseAnswerPhoto(body: unknown): Parsed<{ assetIds: string[] }> {
  const raw = obj(body).assetIds;
  const ids = Array.isArray(raw) ? [...new Set(raw)] : [];
  if (!ids.length || !ids.every(isRequestId)) return { ok: false, error: 'Escolha ou envie uma foto antes de responder.' };
  if (ids.length > PHOTOS_PER_ANSWER) return { ok: false, error: `Responda com até ${PHOTOS_PER_ANSWER} fotos.` };
  return { ok: true, value: { assetIds: ids as string[] } };
}

export type ConfirmAnswer = { action: 'keep'; validUntil: unknown } | { action: 'edit'; text: unknown; validUntil: unknown } | { action: 'off' };

// A ação vem daqui; o texto e o prazo passam pelo parser dos fatos (parseFactPatch), o mesmo da tela de fatos.
export function parseAnswerConfirm(body: unknown): Parsed<ConfirmAnswer> {
  const b = obj(body);
  if (b.action === 'keep') return { ok: true, value: { action: 'keep', validUntil: b.valid_until ?? null } };
  if (b.action === 'edit') return { ok: true, value: { action: 'edit', text: b.text, validUntil: b.valid_until ?? null } };
  if (b.action === 'off') return { ok: true, value: { action: 'off' } };
  return { ok: false, error: 'Diga se o fato continua, mudou ou não vale mais.' };
}

export const isMediaTag = (t: unknown): t is MediaTag => typeof t === 'string' && (MEDIA_TAGS as readonly string[]).includes(t);
