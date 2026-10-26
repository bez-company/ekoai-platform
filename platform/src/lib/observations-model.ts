// observations-model.ts: as observações do público que a tela Aprendizado › O público mostra (SPEC 022,
// BEZ-206). Puro, sem I/O. Cada observação é montada por template, só com números da conta: nunca texto livre
// do modelo. Duas delas podem virar dica no planejamento de ideias (`usable`); a dica entra no prompt como
// peso leve e nunca vira regra da marca nem passa por cima de fatos e regras.

import { AGE_BUCKETS, type AgeBucket } from './audience-model';
import { MIN_GROUP, describeSlots, type Breakdown, type Recommendation } from './content-analysis-model';
import type { Audience } from './audience-model';

export const OBSERVATION_KEYS = ['content', 'audience'] as const;
export type ObservationKey = (typeof OBSERVATION_KEYS)[number];

export function isObservationKey(v: unknown): v is ObservationKey {
  return typeof v === 'string' && (OBSERVATION_KEYS as readonly string[]).includes(v);
}

export type Observation = {
  id: 'content' | 'audience' | 'hours' | 'format';
  text: string;
  evidence: string;
  // Pode ser ligada como dica no planejamento (guarda a escolha em observation_settings).
  usable: boolean;
  // poucos posts para concluir: aparece cinza, com o motivo, e sem interruptor.
  few: boolean;
};

type Input = {
  breakdown: Breakdown;
  insight: { text: string; evidence: string } | null;
  audience: Pick<Audience, 'age' | 'gender' | 'status' | 'followers'> | null;
  recommendation: Recommendation;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const rate = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')}%`;

// Início e fim da faixa de duas faixas etárias vizinhas: "25 e 44 anos"; a última vira "a partir de 55 anos".
function rangeText(a: AgeBucket, b: AgeBucket): string {
  const lo = Number.parseInt(a, 10);
  if (b === '65+') return `a partir de ${lo} anos`;
  const hi = Number(b.split('-')[1]);
  return `entre ${lo} e ${hi} anos`;
}

// O par de faixas vizinhas que concentra mais gente.
export function topAgePair(age: Record<AgeBucket, number>): { from: AgeBucket; to: AgeBucket; share: number } | null {
  let best: { from: AgeBucket; to: AgeBucket; share: number } | null = null;
  for (let i = 0; i < AGE_BUCKETS.length - 1; i += 1) {
    const share = Math.round(((age[AGE_BUCKETS[i]] ?? 0) + (age[AGE_BUCKETS[i + 1]] ?? 0)) * 10000) / 10000;
    if (!best || share > best.share) best = { from: AGE_BUCKETS[i], to: AGE_BUCKETS[i + 1], share };
  }
  return best && best.share > 0 ? best : null;
}

function audienceText(a: NonNullable<Input['audience']>): string | null {
  if (a.status !== 'ok' || !a.age) return null;
  const pair = topAgePair(a.age);
  if (!pair) return null;
  let text = `Seu público tem ${pct(pair.share)} ${rangeText(pair.from, pair.to)}`;
  if (a.gender) {
    const women = a.gender.F ?? 0;
    const men = a.gender.M ?? 0;
    if (women >= 0.5 || men >= 0.5) text += ` e ${pct(Math.max(women, men))} de ${women >= men ? 'mulheres' : 'homens'}`;
  }
  return `${text}.`;
}

// A comparação entre formatos: só informa; nunca vira dica, porque o formato depende de o que se quer dizer.
function formatObservation(b: Breakdown): Observation | null {
  // O texto abre pelo que rendeu mais, mesmo quando é o grupo pequeno (ele só não conta como conclusão).
  const [top, second] = [...b.format].sort((x, y) => y.avg - x.avg);
  if (!b.ready || !top || !second) return null;
  const few = top.low || second.low;
  const base = `${top.label} rendeu ${rate(top.avg)} contra ${rate(second.avg)} de ${second.label.toLowerCase()}.`;
  const small = top.low ? top : second;
  return {
    id: 'format',
    text: base,
    evidence: few ? `Só ${small.n} ${small.n === 1 ? 'post' : 'posts'} de ${small.label.toLowerCase()}: poucos posts para concluir. A observação conta quando houver ${MIN_GROUP} ou mais por grupo.` : `${top.n} posts contra ${second.n} · últimos 60 dias`,
    usable: false,
    few,
  };
}

export function buildObservations(input: Input): Observation[] {
  const out: Observation[] = [];
  if (input.insight) out.push({ id: 'content', text: input.insight.text, evidence: `${input.insight.evidence} · últimos 60 dias`, usable: true, few: false });
  const audience = input.audience ? audienceText(input.audience) : null;
  if (audience) out.push({ id: 'audience', text: audience, evidence: `Seguidores da conta · últimos 30 dias`, usable: true, few: false });
  if (input.recommendation.ok) {
    const r = input.recommendation;
    out.push({ id: 'hours', text: `Os melhores horários para publicar são ${describeSlots(r.slots)}.`, evidence: `${r.basedOn} posts${r.usedOnline ? ' e horário online dos seguidores' : ''}`, usable: false, few: false });
  }
  const format = formatObservation(input.breakdown);
  if (format) out.push(format);
  return out;
}

// As dicas que vão ao prompt de ideias: só as observações usáveis que a pessoa ligou. Texto de template.
export function plannerHints(observations: readonly Observation[], enabled: readonly ObservationKey[]): string[] {
  return observations.filter((o) => o.usable && (enabled as readonly string[]).includes(o.id)).map((o) => o.text);
}

export type ObservationInput = { key: ObservationKey; enabled: boolean };

// PUT /api/learning/observations: valida o corpo antes de qualquer I/O.
export function parseObservationInput(body: unknown): { ok: true; value: ObservationInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isObservationKey(b.key)) return { ok: false, error: 'Observação não encontrada. Recarregue a página.' };
  if (typeof b.enabled !== 'boolean') return { ok: false, error: 'Diga se a observação entra no planejamento ou não.' };
  return { ok: true, value: { key: b.key, enabled: b.enabled } };
}
