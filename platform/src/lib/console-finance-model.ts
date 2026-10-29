// console-finance-model.ts: o custo real de um post por grupo de etapa e por rede (SPEC 031, entrega 3). A parte pura do Console › Financeiro.
// O custo é o `cost_usd` de cada chamada de `generation_runs`, em dólar; o real vem da cotação datada de pricing.json. Não há "cobrado" nem
// margem: a cobrança real é do BEZ-301.

import type { Channel } from './types';

export const GROUPS = [
  { id: 'core', label: 'Núcleo e legenda', steps: ['directives', 'strategist', 'writer', 'core'] },
  { id: 'networks', label: 'Texto por rede', steps: ['adapt'] },
  { id: 'review', label: 'Avaliação e conserto', steps: ['critic', 'fix', 'review'] },
  { id: 'image', label: 'Imagem', steps: ['visual', 'art', 'render'] },
  { id: 'publish', label: 'Publicação', steps: ['publish'] },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];

const GROUP_OF = new Map<string, GroupId>(GROUPS.flatMap((g) => g.steps.map((s) => [s, g.id] as const)));
export const groupOf = (step: string): GroupId | null => GROUP_OF.get(step) ?? null;

export type RunCost = { step: string; channel: string | null; costUsd: number };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const toRunCost = (row: { step: unknown; channel?: unknown; cost_usd?: unknown }): RunCost => ({ step: String(row.step), channel: row.channel ? String(row.channel) : null, costUsd: num(row.cost_usd) });

export const totalCost = (runs: readonly RunCost[]): number => runs.reduce((n, r) => n + r.costUsd, 0);

export function costByGroup(runs: readonly RunCost[]): Record<GroupId, number> {
  const out: Record<GroupId, number> = { core: 0, networks: 0, review: 0, image: 0, publish: 0 };
  for (const r of runs) {
    const g = groupOf(r.step);
    if (g) out[g] += r.costUsd;
  }
  return out;
}

// Por rede. O que não é de uma rede (ler o pedido, o redator que devolve o núcleo) fica em `shared`.
export type ChannelCost = Record<Channel | 'shared', number>;
export function costByChannel(runs: readonly RunCost[]): ChannelCost {
  const out: ChannelCost = { instagram: 0, linkedin: 0, twitter: 0, shared: 0 };
  for (const r of runs) {
    const key = r.channel === 'instagram' || r.channel === 'linkedin' || r.channel === 'twitter' ? r.channel : 'shared';
    out[key] += r.costUsd;
  }
  return out;
}

// Dólar com 4 casas quando é centavo (o custo de um post é de centavos), 2 casas quando passa de 1. Real sempre com 2.
export function fmtUsd(n: number): string {
  const digits = Math.abs(n) >= 1 ? 2 : 4;
  return `US$ ${n.toFixed(digits).replace('.', ',')}`;
}

export const fmtBrl = (n: number): string => `R$ ${n.toFixed(2).replace('.', ',')}`;

// Quanto de `part` há em `whole`, em %, sem dividir por zero.
export const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// A ordem da esteira: as chamadas que gravam o mesmo horário saem na ordem em que acontecem (ler o pedido, redator, texto por rede, avaliação...).
const STEP_ORDER: string[] = GROUPS.flatMap((g) => [...g.steps]);
export const stepRank = (step: string): number => {
  const i = STEP_ORDER.indexOf(step);
  return i === -1 ? STEP_ORDER.length : i;
};
