// analysis-view.ts: o que a tela Publicados › Analytics mostra em cada estado (SPEC 022, BEZ-206). Puro:
// recebe o que `loadAnalysis` juntou e decide qual cartão aparece e com que texto. A tela só desenha.

import { AGE_BUCKETS, GENDER_KEYS, MIN_FOLLOWERS, type AgeBucket, type GenderKey } from './audience-model';
import { MIN_POSTS, describeSlots, type Breakdown, type Recommendation } from './content-analysis-model';
import type { Analysis } from './content-analysis';

export type ContentView = { state: 'ready'; breakdown: Breakdown; insight: Analysis['insight'] } | { state: 'wait'; have: number; need: number };

export type AudienceCardView =
  | { state: 'ok'; followers: number | null; capturedOn: string; age: { label: string; value: number; top: boolean }[] | null; gender: { label: string; key: GenderKey; value: number }[] | null }
  | { state: 'too_few'; followers: number | null; need: number }
  | { state: 'unavailable' }
  | { state: 'none' };

export type HoursView = {
  // online: horário em que os seguidores estão online (Meta); own: engajamento dos próprios posts por hora.
  mode: 'online' | 'own' | 'none';
  // 24 posições (0 a 23h); nulo onde não há dado.
  values: (number | null)[];
  peaks: string;
  recommendation: Recommendation;
};

export type AnalysisView = {
  // no_instagram: nada conectado; no_permission: conectado sem a permissão de insights; ready: mostra os cartões.
  gate: 'no_instagram' | 'no_permission' | 'ready';
  content: ContentView;
  audience: AudienceCardView;
  hours: HoursView;
};

const AGE_LABEL: Record<AgeBucket, string> = { '13-17': '13 a 17', '18-24': '18 a 24', '25-34': '25 a 34', '35-44': '35 a 44', '45-54': '45 a 54', '55-64': '55 a 64', '65+': '65 ou mais' };
const GENDER_LABEL: Record<GenderKey, string> = { F: 'Mulheres', M: 'Homens', U: 'Não informado' };

const hoursText = (hours: number[]) => (hours.length <= 1 ? `${hours[0]}h` : `${hours.slice(0, -1).map((h) => `${h}h`).join(', ')} e ${hours[hours.length - 1]}h`);

// As horas de maior valor, em ordem do dia: as que chegam a `ratio` do pico (no máximo `max`). Hora sem dado fica de fora.
export function peakHours(values: (number | null)[], ratio = 0.9, max = 3): number[] {
  const peak = Math.max(0, ...values.map((v) => v ?? 0));
  if (peak <= 0) return [];
  return values
    .map((v, h) => ({ v: v ?? 0, h }))
    .filter((x) => x.v > 0 && x.v >= peak * ratio)
    .sort((a, b) => b.v - a.v || a.h - b.h)
    .slice(0, max)
    .map((x) => x.h)
    .sort((a, b) => a - b);
}

function audienceView(a: Analysis): AudienceCardView {
  const au = a.audience;
  if (!au) return { state: 'none' };
  if (au.status === 'too_few_followers') return { state: 'too_few', followers: au.followers, need: MIN_FOLLOWERS };
  if (au.status !== 'ok' || (!au.age && !au.gender)) return { state: 'unavailable' };
  // O jsonb do banco devolve as chaves em outra ordem: a ordem das faixas e dos gêneros é a do modelo.
  const ages = au.age ? AGE_BUCKETS.filter((k) => typeof au.age![k] === 'number') : [];
  const topAge = ages.reduce((best, k) => (au.age![k] > (au.age![best] ?? -1) ? k : best), ages[0]);
  return {
    state: 'ok',
    followers: au.followers,
    capturedOn: au.capturedOn,
    age: au.age ? ages.map((k) => ({ label: AGE_LABEL[k], value: au.age![k], top: k === topAge })) : null,
    gender: au.gender ? GENDER_KEYS.filter((k) => typeof au.gender![k] === 'number').map((k) => ({ key: k, label: GENDER_LABEL[k], value: au.gender![k] })) : null,
  };
}

function hoursView(a: Analysis): HoursView {
  const online = a.audience?.onlineHours ?? null;
  if (online) {
    const peaks = peakHours(online);
    return { mode: 'online', values: online, peaks: peaks.length ? `Pico às ${hoursText(peaks)}.` : '', recommendation: a.recommendation };
  }
  const own = a.ownHours;
  // Poucas horas têm post: mostra as duas melhores, sem exigir que cheguem perto do pico.
  const peaks = peakHours(own, 0, 2);
  if (!peaks.length) return { mode: 'none', values: own, peaks: '', recommendation: a.recommendation };
  return { mode: 'own', values: own, peaks: `Melhores horas para publicar: ${hoursText(peaks)}.`, recommendation: a.recommendation };
}

export function analysisView(a: Analysis): AnalysisView {
  const gate = !a.connected ? 'no_instagram' : !a.insights ? 'no_permission' : 'ready';
  return {
    gate,
    content: a.breakdown.ready ? { state: 'ready', breakdown: a.breakdown, insight: a.insight } : { state: 'wait', have: a.breakdown.counted, need: MIN_POSTS },
    audience: audienceView(a),
    hours: hoursView(a),
  };
}

// "Ter 19h, Sex 11h, Sáb 10h" para a faixa de recomendação; o texto de falta quando ainda não dá.
export function recommendationText(r: Recommendation): string {
  if (r.ok) return describeSlots(r.slots);
  return r.reason === 'few_posts' ? `Faltam ${r.need - r.have} ${r.need - r.have === 1 ? 'post' : 'posts'} para recomendar horários.` : `Os posts saíram em poucos horários diferentes: faltam ${r.need - r.have} para comparar.`;
}

// Link da Agenda com as sugestões, que o diálogo de Horários marca (entrega d): "?edit=slots&sugestao=2-19,5-11".
export function suggestionHref(r: Recommendation): string {
  if (!r.ok) return '/agenda?edit=slots';
  return `/agenda?edit=slots&sugestao=${r.slots.map((s) => `${s.weekday}-${s.hour}`).join(',')}`;
}
