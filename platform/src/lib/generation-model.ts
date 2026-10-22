// generation-model.ts: o vocabulário da geração de posts por agentes (SPEC 012, ADR 0017). Puro,
// sem I/O: as etapas, o tipo do post, a chave de idempotência (hash da entrada de cada etapa) e a
// leitura do erro de limite do plano que o banco levanta.

import { createHash } from 'node:crypto';

export const STEPS = ['strategist', 'writer', 'art', 'visual', 'review', 'render'] as const;
export type Step = (typeof STEPS)[number];

export const POST_KINDS = ['informativo', 'atmosfera'] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const RATIOS = ['1:1', '4:5'] as const;
export type Ratio = (typeof RATIOS)[number];
export const DEFAULT_RATIO: Ratio = '4:5'; // retrato ocupa mais tela no feed (SPEC 017 decisão 5)

export function isRatio(value: unknown): value is Ratio {
  return typeof value === 'string' && (RATIOS as readonly string[]).includes(value);
}

// O objetivo do post (SPEC 017 decisão 6): o que a pessoa quer, no lugar de "informativo" e
// "atmosfera". A montagem passa a ser decisão interna: `kind` diz quem manda (texto ou imagem);
// null deixa o estrategista escolher. `hint` vai ao prompt para o redator saber o que o post faz.
export const POST_GOALS = ['ensinar', 'produto', 'bastidores', 'novidade', 'promocao', 'prova_social', 'data_comemorativa', 'conversa', 'auto'] as const;
export type PostGoal = (typeof POST_GOALS)[number];

export const GOALS: Record<PostGoal, { label: string; example: string; kind: PostKind | null; hint: string }> = {
  ensinar: { label: 'Ensinar algo', example: '3 jeitos de conservar o bolo', kind: 'informativo', hint: 'ensinar algo útil ao público: dica, passo a passo ou dado' },
  produto: { label: 'Mostrar o produto ou serviço', example: 'O bolo de pote de ninho', kind: 'atmosfera', hint: 'mostrar um produto ou serviço da empresa, com desejo e detalhe' },
  bastidores: { label: 'Bastidores', example: 'Como a massa é feita', kind: 'atmosfera', hint: 'mostrar os bastidores: o processo, a equipe, o dia a dia' },
  novidade: { label: 'Novidade ou aviso', example: 'Abrimos domingo', kind: 'informativo', hint: 'dar uma novidade ou um aviso claro (horário, lançamento, mudança)' },
  promocao: { label: 'Promoção', example: 'Leve 3, pague 2 até sexta', kind: 'informativo', hint: 'anunciar uma promoção; condição e prazo só se estiverem nos fatos' },
  prova_social: { label: 'Prova social', example: 'O que os clientes dizem', kind: 'informativo', hint: 'mostrar prova social (depoimento, avaliação); nunca invente depoimento nem nome de cliente' },
  data_comemorativa: { label: 'Data comemorativa', example: 'Dia das Crianças', kind: null, hint: 'aproveitar uma data comemorativa ligada ao negócio' },
  conversa: { label: 'Conversa com o público', example: 'Qual você prefere?', kind: 'informativo', hint: 'puxar conversa: uma pergunta direta que o público responde nos comentários' },
  auto: { label: 'Deixar a Ekoai escolher', example: 'A Ekoai decide pela sequência', kind: null, hint: '' },
};

export function isPostGoal(value: unknown): value is PostGoal {
  return typeof value === 'string' && (POST_GOALS as readonly string[]).includes(value);
}

// A montagem que o objetivo pede. O tipo escolhido à mão (pedido antigo) vale sobre o objetivo.
export function kindForGoal(goal: PostGoal | null, explicit: PostKind | null = null): PostKind | null {
  if (explicit) return explicit;
  return goal ? GOALS[goal].kind : null;
}

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === 'string' && (POST_KINDS as readonly string[]).includes(value);
}

export function isStep(value: unknown): value is Step {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

// JSON com as chaves em ordem, em qualquer profundidade: a mesma entrada dá sempre o mesmo texto,
// não importa a ordem em que o objeto foi montado.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// A chave de idempotência de uma etapa: etapa, modelo e entrada. Trocar qualquer um deles (outra
// direção, outro modelo, texto editado) é uma chamada nova e, no visual, conta no limite.
export function inputHash(step: Step, model: string, input: unknown): string {
  return createHash('sha256').update(canonical({ step, model, input })).digest('hex');
}

export type RunStatus = 'reserved' | 'done' | 'failed';

export type GenerationRun = {
  id: string;
  briefId: string;
  step: Step;
  inputHash: string;
  status: RunStatus;
  model: string | null;
  modelVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  images: number;
  costUsd: number | null;
  durationMs: number | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

export function runFromRow(row: Record<string, unknown>): GenerationRun {
  const num = (k: string) => (row[k] == null ? null : Number(row[k]));
  return {
    id: String(row.id),
    briefId: String(row.brief_id),
    step: row.step as Step,
    inputHash: String(row.input_hash),
    status: row.status as RunStatus,
    model: typeof row.model === 'string' ? row.model : null,
    modelVersion: typeof row.model_version === 'string' ? row.model_version : null,
    inputTokens: num('input_tokens'),
    outputTokens: num('output_tokens'),
    images: Number(row.images ?? 0),
    costUsd: num('cost_usd'),
    durationMs: num('duration_ms'),
    result: row.result ?? null,
    error: typeof row.error === 'string' ? row.error : null,
    createdAt: iso(row.created_at) ?? '',
    finishedAt: iso(row.finished_at),
  };
}

// O gatilho app.check_post_limit levanta check_violation com a dica plan_posts.
export function isPlanPostsLimit(error: { code?: string | null; hint?: string | null } | null | undefined): boolean {
  return !!error && error.hint === 'plan_posts';
}

// Início do mês em UTC, o mesmo recorte do gatilho e da fatura do provedor.
export function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type Usage = { used: number; max: number; remaining: number };

export function usageOf(used: number, max: number): Usage {
  return { used, max, remaining: Math.max(0, max - used) };
}

export const LIMIT_MESSAGE = (max: number) =>
  `Você usou os ${max} posts deste mês. O limite volta no dia 1º. Você ainda pode editar e aprovar os posts que já existem.`;
