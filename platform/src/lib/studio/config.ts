// config.ts: o que cada nível de esforço faz por dentro (SPEC 030, decisão 2): quantos rascunhos, quantas voltas de refino, que modelo
// em cada papel e o teto de custo. Só os níveis com cadeia de agentes aparecem aqui; Instantâneo é o motor atual e Padrão (uma
// chamada) ainda não existe. Os valores vêm do eval (docs/analises/2026-10-28-custo-e-preco-por-post.md).

import type { Effort } from './levels';

export type ModelRole = 'smart' | 'fast';
export type Thinking = 'minimal' | 'low' | 'medium' | 'high';

export type LevelPlan = {
  drafts: number; // rascunhos do designer em paralelo; o crítico escolhe
  polishRounds: number; // voltas do embelezador, com guarda contra regressão
  gateRepairs: number; // voltas de conserto depois do revisor final
  // Marketing, diretor, redator, direção de arte, crítico e revisor em Pro: o juiz forte segura a qualidade (Flash nessas etapas perdeu 0,9 de nota).
  designer: ModelRole; // designer, conserto e embelezador
  designerThinking: Thinking;
  capUsd: number; // acima disso a geração fecha com a melhor versão que existe
};

export const STUDIO_EFFORTS = ['refinado', 'autoral', 'pro'] as const;
export type StudioEffort = (typeof STUDIO_EFFORTS)[number];

export const isStudioEffort = (e: Effort): e is StudioEffort => (STUDIO_EFFORTS as readonly string[]).includes(e);

export const LEVEL_PLANS: Record<StudioEffort, LevelPlan> = {
  refinado: { drafts: 1, polishRounds: 2, gateRepairs: 2, designer: 'fast', designerThinking: 'medium', capUsd: 0.9 },
  autoral: { drafts: 1, polishRounds: 2, gateRepairs: 2, designer: 'smart', designerThinking: 'low', capUsd: 0.9 },
  pro: { drafts: 2, polishRounds: 2, gateRepairs: 2, designer: 'smart', designerThinking: 'medium', capUsd: 1.2 },
};

// O estúdio usa a mesma lista de modelos do eval (STUDIO_*_MODEL só no eval); em produção os nomes vêm da configuração do Vertex.
export const STUDIO_MODELS: Record<ModelRole, string> = { smart: 'gemini-3.1-pro-preview', fast: 'gemini-3-flash-preview' };

export const SHIP_SCORE = 8;
export const MAX_COPY_ROUNDS = 3;
