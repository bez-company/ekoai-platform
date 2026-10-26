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
//
// Campanha (SPEC 018): com uma campanha ativa, confirmada e dentro do prazo, parte dos horários livres da
// semana é dela (campaignSlotQuota), espalhados entre os horários e nunca no lugar de uma data comemorativa.
// O tipo da campanha diz de quais objetivos o horário sai; as travas valem do mesmo jeito (sem repetir o
// objetivo anterior, promoção a cada 4 posts, foto real que casa com o tipo). Quem escolhe horário, objetivo
// e foto é esta regra, nunca o modelo. O motivo de cada sugestão sai de um template, não do modelo.

import { GOALS, type PostGoal } from './generation-model';
import { reviewText } from './design/review';
import type { InactiveFact } from './company-facts-model';
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
export type PlanRule = 'date' | 'photo' | 'rotation' | 'campaign';
export type PlannedSuggestion = { slotAt: string; goal: PostGoal; assetId: string | null; dateKey: string | null; reason: string; rule: PlanRule; campaignId: string | null };

// A campanha em vigor, como o planejador a vê: o tipo já virou lista de objetivos de post. `remaining` é
// quantos horários desta rodada ainda são dela; `plannedTotal` é quantos posts de campanha a semana já tem
// (sugestões abertas, pedidos e agendados), só para o motivo dizer "2 de 3 posts da semana".
// `existingSlots` (ISO) diz quando caem esses posts, para o motivo numerar na ordem do calendário; sem ele, vale a contagem.
export type PlanCampaign = { id: string; name: string; goals: readonly PostGoal[]; remaining: number; plannedTotal: number; offering?: string | null; existingSlots?: readonly string[] };

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
  campaign?: PlanCampaign | null;
  // Trocar um horário: a sugestão nova segue no mesmo grupo da trocada (de campanha ou de rotação).
  slotRules?: Record<string, 'campaign' | 'free'>;
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

const shortName = (name: string) => (name.length > 30 ? `${name.slice(0, 27).trimEnd()}...` : name);

// Escolhe `count` posições espalhadas de ponta a ponta (3 horários e 2 de campanha: o primeiro e o último;
// 5 e 3: o primeiro, o do meio e o último), para a campanha alternar com a rotação em vez de vir em bloco.
function spread<T>(list: readonly T[], count: number): T[] {
  if (count <= 0 || !list.length) return [];
  if (count >= list.length) return [...list];
  if (count === 1) return [list[0]];
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
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
  const campaign = input.campaign ?? null;
  const out: PlannedSuggestion[] = [];

  // 1. Quais horários uma data comemorativa leva (ela ganha da campanha e da rotação).
  const dateBySlot = new Map<number, CommemorativeDate>();
  const claimed = new Set(usedDates);
  for (const slotMs of slots) {
    const avoid = new Set(input.slotRules?.[new Date(slotMs).toISOString()] === 'free' ? [] : input.avoid?.[new Date(slotMs).toISOString()] ?? []);
    if (avoid.has('data_comemorativa')) continue;
    const slotDay = localDay(slotMs, offset);
    const limitDay = localDay(slotMs + DATE_LEAD_DAYS * DAY, offset);
    const date = (input.dates ?? []).find((d) => d.date >= slotDay && d.date <= limitDay && !claimed.has(d.key));
    if (date) {
      dateBySlot.set(slotMs, date);
      claimed.add(date.key);
    }
  }

  // 2. Quais horários são da campanha: os que a troca manteve, mais os espalhados entre os que sobram.
  const campaignSlots: number[] = [];
  if (campaign) {
    const open = slots.filter((ms) => !dateBySlot.has(ms));
    const rule = (ms: number) => input.slotRules?.[new Date(ms).toISOString()];
    const forced = open.filter((ms) => rule(ms) === 'campaign');
    const pickable = open.filter((ms) => rule(ms) === undefined);
    campaignSlots.push(...forced, ...spread(pickable, Math.min(Math.max(campaign.remaining - forced.length, 0), pickable.length)));
    campaignSlots.sort((a, b) => a - b);
  }
  const campaignSet = new Set(campaignSlots);
  const existingMs = (campaign?.existingSlots ?? []).map((iso) => new Date(iso).getTime());
  const weekTotal = (campaign?.existingSlots ? existingMs.length : campaign?.plannedTotal ?? 0) + campaignSlots.length;
  const campaignOrder = [...existingMs, ...campaignSlots].sort((a, b) => a - b);

  for (const slotMs of slots) {
    const slotIso = new Date(slotMs).toISOString();
    const avoid = new Set(input.avoid?.[slotIso] ?? []);
    const before = timeline.filter((h) => h.ms < slotMs);
    const last = before.at(-1)?.goal ?? null;
    const lastTwo = before.slice(-2).map((h) => h.goal);
    const recent = before.slice(-(PROMO_WINDOW - 1)).map((h) => h.goal);
    const inCampaign = campaign !== null && campaignSet.has(slotMs);

    let goal: PostGoal | null = null;
    let assetId: string | null = null;
    let dateKey: string | null = null;
    let reason = '';
    let rule: PlanRule = 'rotation';
    let photoDesc: string | null = null;
    let photoSince = '';

    // 1. Data comemorativa logo à frente.
    const slotDay = localDay(slotMs, offset);
    const date = dateBySlot.get(slotMs);
    if (date && !avoid.has('data_comemorativa')) {
      goal = 'data_comemorativa';
      dateKey = date.key;
      usedDates.add(date.key);
      rule = 'date';
      const [y, m, d] = date.date.split('-').map(Number);
      const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
      reason = date.date === slotDay ? `Hoje é ${date.name}.` : `${date.name} é ${weekday} (${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}).`;
    }

    // 2 e 3. Objetivos permitidos neste horário (e, no horário da campanha, só os do tipo dela).
    const allowed = SEQUENCE_GOALS.filter((g) => g !== last && !avoid.has(g) && !(g === 'promocao' && recent.includes('promocao')));
    const basePool = allowed.length ? allowed : SEQUENCE_GOALS.filter((g) => g !== last);
    let pool: readonly PostGoal[] = basePool;
    if (inCampaign) {
      const own = campaign.goals.filter((g) => (basePool as readonly PostGoal[]).includes(g));
      pool = own.length ? own : campaign.goals.filter((g) => g !== last).length ? campaign.goals.filter((g) => g !== last) : campaign.goals;
    }

    // 4. Foto real: o banco tem foto e faz uma semana (contando as sugestões desta rodada) sem foto.
    const lastPhotoMs = [...before].reverse().find((h) => h.withPhoto)?.ms ?? null;
    const needsPhoto = !goal && input.photos.length > 0 && (lastPhotoMs === null || slotMs - lastPhotoMs >= (PHOTO_EVERY_DAYS - 1) * DAY);
    if (needsPhoto) {
      const free = input.photos.filter((p) => !usedPhotos.has(p.id));
      const pick =
        free.find((p) => p.tags.some((t) => pool.includes(PHOTO_GOAL[t]))) ??
        free.find(() => pool.includes('produto'));
      if (pick) {
        assetId = pick.id;
        usedPhotos.add(pick.id);
        goal = pick.tags.map((t) => PHOTO_GOAL[t]).find((g) => pool.includes(g)) ?? 'produto';
        photoDesc = shortDescription(pick.description);
        photoSince = lastPhotoMs === null ? 'Ainda não saiu foto real da empresa.' : `Faz ${Math.round((slotMs - lastPhotoMs) / DAY)} dias que não sai foto real.`;
        rule = 'photo';
        reason = `${GOALS[goal].label} com a foto ${photoDesc ? `"${photoDesc}"` : 'do banco'}. ${photoSince}`;
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
      goal = [...pool].sort((a, b) => score(b) - score(a) || (SEQUENCE_GOALS as readonly PostGoal[]).indexOf(a) - (SEQUENCE_GOALS as readonly PostGoal[]).indexOf(b))[0];
      const top = [...engagement.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[0] === goal) reason = `${GOALS[goal].label} é o que mais engaja na sua conta.`;
      else if (!before.length) reason = `Primeiro post da sequência: ${lower(goal)} apresenta a empresa.`;
      else if (lastTwo.length === 2 && lastTwo[0] && lastTwo[0] === lastTwo[1]) reason = `Os dois últimos foram ${lower(lastTwo[0])}; ${lower(goal)} varia a sequência.`;
      else if (last) reason = `O último foi ${lower(last)}; ${lower(goal)} varia a sequência.`;
      else reason = `${GOALS[goal].label} varia a sequência.`;
    }

    // O horário da campanha diz isso primeiro, e depois o que decidiu o objetivo (template, sem modelo).
    if (inCampaign && rule !== 'date') {
      rule = 'campaign';
      const k = campaign.existingSlots ? campaignOrder.indexOf(slotMs) + 1 : campaign.plannedTotal + campaignSlots.indexOf(slotMs) + 1;
      const photo = assetId ? ` com a foto ${photoDesc ? `"${photoDesc}"` : 'do banco'}` : '';
      reason = `Campanha ${shortName(campaign.name)}: ${k} de ${weekTotal} posts da semana. ${GOALS[goal].label}${photo}${last ? `; o último foi ${lower(last)}` : ''}.`;
    }

    out.push({ slotAt: slotIso, goal, assetId, dateKey, reason: cut(reason), rule, campaignId: inCampaign && rule === 'campaign' ? campaign.id : null });
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
// modelo de texto, numa chamada por rodada. Ele só escreve a frase: horário, objetivo e foto já vieram da
// regra. Entram na chamada só os fatos confirmados e dentro da validade e, nos itens da campanha, o que a
// campanha diz. Se o modelo falhar, passar do teto de custo ou escrever número fora dos fatos, a ideia sai
// do próprio objetivo (fallbackIdea): a sequência, o motivo e os horários são os mesmos com ou sem modelo.
export type IdeaCampaign = { name: string; objective: string | null; offering: string | null; audience: string | null; restrictions: readonly string[] };
export type IdeaItem = { i: number; goal: PostGoal; photo: string | null; date: string | null; campaign?: boolean };

export function ideasPrompt(input: { niche: string | null; offering: string | null; items: IdeaItem[]; campaign?: IdeaCampaign | null; facts?: readonly string[]; never?: readonly string[]; hints?: readonly string[] }): string {
  const camp = input.campaign ?? null;
  const facts = input.facts ?? [];
  const never = [...(input.never ?? []), ...(camp?.restrictions ?? [])];
  const hints = input.hints ?? [];
  return [
    'Você é o coordenador de conteúdo do Instagram de uma empresa brasileira.',
    input.niche ? `Ramo: ${input.niche}.` : '',
    input.offering ? `O que vende: ${input.offering}.` : '',
    camp ? `Campanha ativa: ${camp.name}.${camp.objective ? ` Resultado que a empresa quer: ${camp.objective}.` : ''}${camp.offering ? ` O que entra nos posts: ${camp.offering}.` : ''}${camp.audience ? ` Para quem: ${camp.audience}.` : ''} Os itens marcados com "campanha: sim" servem a ela; os outros seguem a rotação normal.` : '',
    facts.length ? `Fatos que a empresa pode afirmar (número, preço e prazo só valem se estiverem aqui${camp?.offering ? ' ou na oferta da campanha' : ''}):\n${facts.map((f) => `- ${f}`).join('\n')}` : 'Não há fatos cadastrados: não use número, preço nem prazo.',
    never.length ? `Nunca diga:\n${never.map((f) => `- ${f}`).join('\n')}` : '',
    // SPEC 022: observações do público que a pessoa ligou. Peso leve: nunca mudam os itens, os fatos nem o que não se diz.
    hints.length ? `O que os números desta conta mostram (use só como pista de tom e de assunto, sem mudar os itens abaixo):\n${hints.map((h) => `- ${h}`).join('\n')}` : '',
    `Para cada item, escreva a ideia de um post em uma frase curta (até ${IDEA_MAX} caracteres), em português do Brasil, concreta e sem inventar preço, prazo, desconto, meta, depoimento nem nome de cliente. Nada de travessão.`,
    'Itens:',
    ...input.items.map((it) => `${it.i}. objetivo: ${GOALS[it.goal].hint || GOALS[it.goal].label}${it.date ? `; data: ${it.date}` : ''}${it.photo ? `; foto: ${it.photo}` : ''}${it.campaign ? '; campanha: sim' : ''}`),
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

// A ideia passa pelo mesmo revisor do post: número fora dos fatos (ou só em fato vencido), "nunca afirmar",
// palavra proibida e travessão a barram. `allowed` é o que a campanha escreveu na oferta, só para os itens dela.
const IDEA_RULES = new Set(['number_not_in_facts', 'fact_not_valid', 'never_claim', 'banned_word', 'dash']);

export function ideaProblems(idea: string, ctx: { facts: string[]; never: string[]; banned: string[]; inactive?: InactiveFact[]; allowed?: string[] }): string[] {
  return reviewText({ imageTexts: [], caption: idea, hashtags: [], facts: ctx.facts, never: ctx.never, banned: ctx.banned, inactive: ctx.inactive, allowed: ctx.allowed })
    .filter((i) => IDEA_RULES.has(i.rule))
    .map((i) => i.rule);
}

export function fallbackIdea(goal: PostGoal, photo: string | null, date: string | null, offering: string | null = null): string {
  if (date) return `${date}: um post ligando a data ao que a empresa faz`;
  if (offering) return `${GOALS[goal].label}: ${offering}`.slice(0, IDEA_MAX);
  if (photo) return `${GOALS[goal].label}: ${photo}`.slice(0, IDEA_MAX);
  return `${GOALS[goal].label}, como "${GOALS[goal].example}"`;
}
