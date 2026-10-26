// audience-model.ts: regras puras da leitura do público do Instagram (SPEC 022, BEZ-206). Sem I/O: lê o
// retorno da Graph API, valida o shape e normaliza. O lado com rede e banco fica em audience.ts.
//
// Só agregados da Meta (faixas e percentuais). A resposta que não bate com o formato vira "indisponível" e a
// tela explica; nunca exceção, porque a documentação da Meta tem pontos que se contradizem (timeframe,
// breakdown x breakdowns) e `online_followers` nem consta na tabela de métricas da página atual.

import { graphFailure, type GraphFailure } from './instagram-metrics-model';

// A Meta só entrega faixa etária e gênero a partir de 100 seguidores.
export const MIN_FOLLOWERS = 100;

export const AGE_BUCKETS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export const GENDER_KEYS = ['F', 'M', 'U'] as const;
export type GenderKey = (typeof GENDER_KEYS)[number];

export type AudienceStatus = 'ok' | 'no_permission' | 'too_few_followers' | 'unavailable';

export type Audience = {
  followers: number | null;
  age: Record<AgeBucket, number> | null;
  gender: Record<GenderKey, number> | null;
  // Fração de seguidores online em cada hora (0 a 23), de 0 a 1, relativa ao pico.
  onlineHours: number[] | null;
  status: AudienceStatus;
};

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// "13-17" e "13 - 17" viram "13-17"; "65+" e "65 +" viram "65+". Fora da lista, descarta.
export function ageBucketOf(v: unknown): AgeBucket | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '');
  return (AGE_BUCKETS as readonly string[]).includes(s) ? (s as AgeBucket) : null;
}

export function genderKeyOf(v: unknown): GenderKey | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return (GENDER_KEYS as readonly string[]).includes(s) ? (s as GenderKey) : null;
}

// Soma os valores de cada grupo e devolve a fração do total. Sem total, sem resultado.
function normalize<K extends string>(sums: Map<K, number>, keys: readonly K[]): Record<K, number> | null {
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = round4((sums.get(k) ?? 0) / total);
  return out;
}

// GET /{ig-user-id}/insights?metric=follower_demographics&metric_type=total_value&breakdown=age|gender
// A resposta traz total_value.breakdowns[].{dimension_keys, results[].{dimension_values, value}}. O índice
// da dimensão pedida vem de dimension_keys (o timeframe pode vir como outra dimensão antes dela).
export function parseDemographics(json: unknown, breakdown: 'age' | 'gender'): Record<string, number> | null {
  const data = record(json)?.data;
  if (!Array.isArray(data)) return null;
  const metric = data.map(record).find((m) => m?.name === 'follower_demographics');
  const breakdowns = record(metric?.total_value)?.breakdowns;
  if (!Array.isArray(breakdowns)) return null;
  const pick = breakdown === 'age' ? ageBucketOf : genderKeyOf;
  const sums = new Map<string, number>();
  for (const b of breakdowns) {
    const entry = record(b);
    const keys = entry?.dimension_keys;
    const results = entry?.results;
    if (!Array.isArray(keys) || !Array.isArray(results)) continue;
    const at = keys.indexOf(breakdown);
    if (at < 0) continue;
    for (const r of results) {
      const row = record(r);
      const dims = row?.dimension_values;
      const value = count(row?.value);
      if (!Array.isArray(dims) || value === null) continue;
      const key = pick(dims[at]);
      if (key) sums.set(key, (sums.get(key) ?? 0) + value);
    }
  }
  return breakdown === 'age' ? normalize(sums, AGE_BUCKETS) : normalize(sums, GENDER_KEYS);
}

// GET /{ig-user-id}/insights?metric=online_followers&period=lifetime: cada `values[].value` é um objeto
// { "0": n, ..., "23": n } com os seguidores online por hora. Vários dias entram pela média de cada hora.
// O resultado vai de 0 a 1 relativo ao pico, que é o que a tela desenha.
export function parseOnlineHours(json: unknown): number[] | null {
  const data = record(json)?.data;
  if (!Array.isArray(data)) return null;
  const metric = data.map(record).find((m) => m?.name === 'online_followers');
  const values = metric?.values;
  if (!Array.isArray(values)) return null;
  const sums = new Array<number>(24).fill(0);
  let days = 0;
  for (const v of values) {
    const byHour = record(record(v)?.value);
    if (!byHour) continue;
    let seen = false;
    for (let h = 0; h < 24; h += 1) {
      const n = count(byHour[String(h)]);
      if (n !== null) {
        sums[h] += n;
        seen = true;
      }
    }
    if (seen) days += 1;
  }
  if (!days) return null;
  const avg = sums.map((s) => s / days);
  const peak = Math.max(...avg);
  if (!(peak > 0)) return null;
  return avg.map((n) => round4(n / peak));
}

// GET /{ig-user-id}?fields=followers_count
export function parseFollowers(json: unknown): number | null {
  const n = record(json)?.followers_count;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

// Erro da Graph que significa "menos de 100 seguidores": a Meta responde 100 com texto que cita o mínimo.
export function isTooFewFollowers(json: unknown): boolean {
  const e = record(record(json)?.error);
  const message = typeof e?.message === 'string' ? e.message : '';
  return e?.code === 100 && /100/.test(message) && /follower/i.test(message);
}

export type AudienceFailure = GraphFailure | 'too_few_followers';

export function audienceFailure(json: unknown): AudienceFailure {
  return isTooFewFollowers(json) ? 'too_few_followers' : graphFailure(json);
}

// O estado do dia a partir do que veio. `insights` diz se a pessoa concedeu a permissão de insights.
export function resolveStatus(a: Pick<Audience, 'followers' | 'age' | 'gender' | 'onlineHours'>, insights: boolean, tooFew: boolean): AudienceStatus {
  if (!insights) return 'no_permission';
  if (tooFew || (a.followers !== null && a.followers < MIN_FOLLOWERS)) return 'too_few_followers';
  return a.age || a.gender || a.onlineHours ? 'ok' : 'unavailable';
}

// Soma das faixas de `from` até `to`, para a frase do aprendizado: "67% entre 25 e 44 anos".
export function ageShare(age: Record<AgeBucket, number>, from: AgeBucket, to: AgeBucket): number {
  const i = AGE_BUCKETS.indexOf(from);
  const j = AGE_BUCKETS.indexOf(to);
  let sum = 0;
  for (let k = i; k <= j; k += 1) sum += age[AGE_BUCKETS[k]];
  return round4(sum);
}
