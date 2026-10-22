// content-plan-model.ts: o coordenador de conteúdo (SPEC 017 decisão 8, BEZ-239). Puro, sem I/O.
// Dado o que já saiu e o que está agendado, os horários livres dos próximos 7 dias, as fotos do banco
// que podem ser sugeridas, as datas comemorativas e (quando houver) o engajamento por objetivo,
// propõe um post por horário livre, cada um com o objetivo, a foto (se houver) e o motivo em uma
// frase. Nada aqui gera post: a pessoa decide (Criar este post, Trocar, Pular).
//
// Regras de sequência (antes de ter métrica):
// 1. data comemorativa em até 3 dias depois do horário, ainda não aproveitada, ganha o horário;
// 2. não repete o objetivo do post anterior;
// 3. no máximo 1 promoção a cada 4 posts;
// 4. ao menos 1 foto real por semana quando o banco tem foto;
// 5. entre os objetivos que sobram, vai o que está há mais tempo sem sair. Com métrica, o
//    engajamento pesa junto, e o coordenador puxa para o objetivo que mais engaja na conta.

import { GOALS, type PostGoal } from './generation-model';
import type { MediaTag } from './media-asset-model';

export const PLAN_DAYS = 7;
export const DATE_LEAD_DAYS = 3;
export const PROMO_WINDOW = 4;
export const PHOTO_EVERY_DAYS = 7;
export const REASON_MAX = 200;
export const IDEA_MAX = 160;

// O que o coordenador alterna. "auto" não é objetivo de sugestão, e a data comemorativa só entra pela regra 1.
export const SEQUENCE_GOALS = ['ensinar', 'produto', 'bastidores', 'novidade', 'promocao', 'prova_social', 'conversa'] as const satisfies readonly PostGoal[];

// Objetivo que a foto pede, pela etiqueta dela.
const PHOTO_GOAL: Record<MediaTag, PostGoal> = {
  produto: 'produto',
  equipe: 'bastidores',
  bastidor: 'bastidores',
  espaco: 'bastidores',
  evento: 'bastidores',
  cliente: 'prova_social',
  outro: 'produto',
};

export type PlanHistoryItem = { at: string; goal: PostGoal | null; withPhoto: boolean };
export type PlanPhoto = { id: string; description: string | null; tags: MediaTag[] };
export type CommemorativeDate = { key: string; name: string; date: string }; // date = AAAA-MM-DD, dia local
export type PlannedSuggestion = { slotAt: string; goal: PostGoal; assetId: string | null; dateKey: string | null; reason: string };

export type PlanInput = {
  now: Date;
  slots: string[]; // ISO, horários livres
  history: PlanHistoryItem[]; // publicados e agendados, em qualquer ordem
  photos: PlanPhoto[]; // só as que podem ser sugeridas (isSuggestable)
  dates?: CommemorativeDate[];
  engagement?: Partial<Record<PostGoal, number>>; // taxa de engajamento média por objetivo
  avoid?: Record<string, PostGoal[]>; // por horário (ISO): objetivos que a pessoa trocou ou pulou
  usedDateKeys?: string[]; // datas comemorativas já aproveitadas (sugestão aberta ou post)
  tzOffsetHours?: number;
};

const DAY = 86_400_000;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const lower = (goal: PostGoal) => GOALS[goal].label.charAt(0).toLowerCase() + GOALS[goal].label.slice(1);

function localDay(ms: number, offset: number): string {
  return new Date(ms + offset * 3_600_000).toISOString().slice(0, 10);
}

function shortDescription(text: string | null): string | null {
  if (!text) return null;
  const first = text.split(/[.;]/)[0].trim();
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}...` : first;
}

function cut(text: string): string {
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 3).trimEnd()}...` : text;
}

// Engajamento normalizado (0 a 1) entre os objetivos que têm métrica. Menos de 2 objetivos medidos não
// diz nada sobre preferência: fica vazio.
function normalizedEngagement(engagement: PlanInput['engagement']): Map<PostGoal, number> {
  const entries = Object.entries(engagement ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0) as [PostGoal, number][];
  if (entries.length < 2) return new Map();
  const max = Math.max(...entries.map(([, v]) => v));
  const min = Math.min(...entries.map(([, v]) => v));
  return new Map(entries.map(([g, v]) => [g, max === min ? 0.5 : (v - min) / (max - min)]));
}

export function planSuggestions(input: PlanInput): PlannedSuggestion[] {
  const offset = input.tzOffsetHours ?? -3;
  const nowMs = input.now.getTime();
  const horizon = nowMs + PLAN_DAYS * DAY;
  const slots = [...new Set(input.slots)].map((s) => new Date(s).getTime()).filter((ms) => ms > nowMs && ms <= horizon).sort((a, b) => a - b);
  const timeline = input.history
    .map((h) => ({ ms: new Date(h.at).getTime(), goal: h.goal, withPhoto: h.withPhoto }))
    .filter((h) => Number.isFinite(h.ms))
    .sort((a, b) => a.ms - b.ms);
  const engagement = normalizedEngagement(input.engagement);
  const usedDates = new Set(input.usedDateKeys ?? []);
  const usedPhotos = new Set<string>();
  const out: PlannedSuggestion[] = [];

  for (const slotMs of slots) {
    const slotIso = new Date(slotMs).toISOString();
    const avoid = new Set(input.avoid?.[slotIso] ?? []);
    const before = timeline.filter((h) => h.ms < slotMs);
    const last = before.at(-1)?.goal ?? null;
    const lastTwo = before.slice(-2).map((h) => h.goal);
    const recent = before.slice(-(PROMO_WINDOW - 1)).map((h) => h.goal);

    let goal: PostGoal | null = null;
    let assetId: string | null = null;
    let dateKey: string | null = null;
    let reason = '';

    // 1. Data comemorativa logo à frente.
    const slotDay = localDay(slotMs, offset);
    const limitDay = localDay(slotMs + DATE_LEAD_DAYS * DAY, offset);
    const date = (input.dates ?? []).find((d) => d.date >= slotDay && d.date <= limitDay && !usedDates.has(d.key));
    if (date && !avoid.has('data_comemorativa')) {
      goal = 'data_comemorativa';
      dateKey = date.key;
      usedDates.add(date.key);
      const [y, m, d] = date.date.split('-').map(Number);
      const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
      reason = date.date === slotDay ? `Hoje é ${date.name}.` : `${date.name} é ${weekday} (${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}).`;
    }

    // 2 e 3. Objetivos permitidos neste horário.
    const allowed = SEQUENCE_GOALS.filter((g) => g !== last && !avoid.has(g) && !(g === 'promocao' && recent.includes('promocao')));
    const pool = allowed.length ? allowed : SEQUENCE_GOALS.filter((g) => g !== last);

    // 4. Foto real: o banco tem foto e faz uma semana (contando as sugestões desta rodada) sem foto.
    const lastPhotoMs = [...before].reverse().find((h) => h.withPhoto)?.ms ?? null;
    const needsPhoto = !goal && input.photos.length > 0 && (lastPhotoMs === null || slotMs - lastPhotoMs >= (PHOTO_EVERY_DAYS - 1) * DAY);
    if (needsPhoto) {
      const free = input.photos.filter((p) => !usedPhotos.has(p.id));
      const pick =
        free.find((p) => p.tags.some((t) => (pool as readonly PostGoal[]).includes(PHOTO_GOAL[t]))) ??
        free.find(() => (pool as readonly PostGoal[]).includes('produto'));
      if (pick) {
        assetId = pick.id;
        usedPhotos.add(pick.id);
        goal = pick.tags.map((t) => PHOTO_GOAL[t]).find((g) => (pool as readonly PostGoal[]).includes(g)) ?? 'produto';
        const desc = shortDescription(pick.description);
        const since = lastPhotoMs === null ? 'Ainda não saiu foto real da empresa.' : `Faz ${Math.round((slotMs - lastPhotoMs) / DAY)} dias que não sai foto real.`;
        reason = `${GOALS[goal].label} com a foto ${desc ? `"${desc}"` : 'do banco'}. ${since}`;
      }
    }

    // 5. O que está há mais tempo sem sair, com o engajamento pesando junto.
    if (!goal) {
      const lastUse = (g: PostGoal) => [...before].reverse().findIndex((h) => h.goal === g);
      const score = (g: PostGoal) => {
        const idx = lastUse(g);
        const recency = idx === -1 ? 1 : Math.min(idx / SEQUENCE_GOALS.length, 1);
        return recency + (engagement.get(g) ?? 0);
      };
      goal = [...pool].sort((a, b) => score(b) - score(a) || SEQUENCE_GOALS.indexOf(a) - SEQUENCE_GOALS.indexOf(b))[0];
      const top = [...engagement.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[0] === goal) reason = `${GOALS[goal].label} é o que mais engaja na sua conta.`;
      else if (!before.length) reason = `Primeiro post da sequência: ${lower(goal)} apresenta a empresa.`;
      else if (lastTwo.length === 2 && lastTwo[0] && lastTwo[0] === lastTwo[1]) reason = `Os dois últimos foram ${lower(lastTwo[0])}; ${lower(goal)} varia a sequência.`;
      else if (last) reason = `O último foi ${lower(last)}; ${lower(goal)} varia a sequência.`;
      else reason = `${GOALS[goal].label} varia a sequência.`;
    }

    out.push({ slotAt: slotIso, goal, assetId, dateKey, reason: cut(reason) });
    timeline.push({ ms: slotMs, goal, withPhoto: assetId !== null });
    timeline.sort((a, b) => a.ms - b.ms);
  }
  return out;
}

// Engajamento por objetivo a partir das métricas do Instagram (BEZ-246). Sem o escopo de insights só
// curtidas e comentários vêm; com ele, também o alcance. A medida precisa ser a mesma em todos os posts
// comparados: se todos têm alcance, vale a taxa (interações / alcance); se algum não tem, vale curtidas
// mais comentários. Post com menos de 2 dias ainda está juntando curtida e fica de fora. Objetivo com
// menos de MIN_POSTS_PER_GOAL posts medidos não entra; com menos de 2 objetivos, o planejador ignora
// (fica só com a regra de sequência).
export const METRICS_DAYS = 90;
export const MIN_POST_AGE_HOURS = 48;
export const MIN_POSTS_PER_GOAL = 2;

export type MetricSample = { goal: PostGoal | null; publishedAt: string; likes: number | null; comments: number | null; rate: number | null };

export function engagementByGoal(samples: MetricSample[], now: Date): Partial<Record<PostGoal, number>> {
  const nowMs = now.getTime();
  const valid = samples.filter((s): s is MetricSample & { goal: PostGoal } => {
    if (!s.goal || !(SEQUENCE_GOALS as readonly string[]).includes(s.goal)) return false;
    const age = nowMs - new Date(s.publishedAt).getTime();
    return age >= MIN_POST_AGE_HOURS * 3_600_000 && age <= METRICS_DAYS * DAY && (s.likes !== null || s.comments !== null || s.rate !== null);
  });
  const useRate = valid.length > 0 && valid.every((s) => s.rate !== null);
  const value = (s: MetricSample) => (useRate ? s.rate! : (s.likes ?? 0) + (s.comments ?? 0));
  const byGoal = new Map<PostGoal, number[]>();
  for (const s of valid) byGoal.set(s.goal, [...(byGoal.get(s.goal) ?? []), value(s)]);
  const out: Partial<Record<PostGoal, number>> = {};
  for (const [goal, values] of byGoal) {
    if (values.length < MIN_POSTS_PER_GOAL) continue;
    out[goal] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return out;
}

// Datas comemorativas de alcance nacional, no dia local. As móveis são calculadas.
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function blackFriday(year: number): string {
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const day = Number(thanksgiving.slice(8)) + 1;
  return `${year}-11-${String(day).padStart(2, '0')}`;
}

export function commemorativeDates(year: number): CommemorativeDate[] {
  const fixed = (key: string, name: string, md: string): CommemorativeDate => ({ key: `${key}-${year}`, name, date: `${year}-${md}` });
  return [
    fixed('mulher', 'Dia da Mulher', '03-08'),
    fixed('consumidor', 'Dia do Consumidor', '03-15'),
    { key: `maes-${year}`, name: 'Dia das Mães', date: nthWeekday(year, 5, 0, 2) },
    fixed('namorados', 'Dia dos Namorados', '06-12'),
    { key: `pais-${year}`, name: 'Dia dos Pais', date: nthWeekday(year, 8, 0, 2) },
    fixed('criancas', 'Dia das Crianças', '10-12'),
    { key: `black-friday-${year}`, name: 'Black Friday', date: blackFriday(year) },
    fixed('natal', 'Natal', '12-25'),
    fixed('ano-novo', 'Ano Novo', '12-31'),
  ];
}

// A ideia de cada sugestão (o que vai no campo "Descreva o que você quer no post") é escrita pelo
// modelo de texto, numa chamada por rodada. Se o modelo falhar, a ideia sai do próprio objetivo.
export function ideasPrompt(input: { niche: string | null; offering: string | null; items: { i: number; goal: PostGoal; photo: string | null; date: string | null }[] }): string {
  return [
    'Você é o coordenador de conteúdo do Instagram de uma empresa brasileira.',
    input.niche ? `Ramo: ${input.niche}.` : '',
    input.offering ? `O que vende: ${input.offering}.` : '',
    `Para cada item, escreva a ideia de um post em uma frase curta (até ${IDEA_MAX} caracteres), em português do Brasil, concreta e sem inventar preço, prazo, depoimento nem nome de cliente.`,
    'Itens:',
    ...input.items.map((it) => `${it.i}. objetivo: ${GOALS[it.goal].hint || GOALS[it.goal].label}${it.date ? `; data: ${it.date}` : ''}${it.photo ? `; foto: ${it.photo}` : ''}`),
    'Responda só com JSON: {"ideas": [{"i": number, "idea": string}]}.',
  ].filter(Boolean).join('\n');
}

export function parseIdeas(json: unknown, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  const list = json && typeof json === 'object' && Array.isArray((json as { ideas?: unknown }).ideas) ? (json as { ideas: unknown[] }).ideas : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { i, idea } = item as { i?: unknown; idea?: unknown };
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= count || typeof idea !== 'string') continue;
    const text = idea.trim().replace(/\s+/g, ' ');
    if (text) out[i] = text.slice(0, IDEA_MAX);
  }
  return out;
}

export function fallbackIdea(goal: PostGoal, photo: string | null, date: string | null): string {
  if (date) return `${date}: um post ligando a data ao que a empresa faz`;
  if (photo) return `${GOALS[goal].label}: ${photo}`.slice(0, IDEA_MAX);
  return `${GOALS[goal].label}, como "${GOALS[goal].example}"`;
}
