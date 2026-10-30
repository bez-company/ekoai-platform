// config.ts: o que cada nível de qualidade faz por dentro (SPEC 030, decisão 2): quantos rascunhos, quantas voltas de refino, que modelo
// em cada papel e o teto de custo. Só os níveis com cadeia de agentes aparecem aqui; o Rápido (id instantaneo) é o motor de modelos. Os valores vêm do eval (docs/analises/2026-10-28-custo-e-preco-por-post.md).

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

export const STUDIO_EFFORTS = ['refinado', 'autoral'] as const;
export type StudioEffort = (typeof STUDIO_EFFORTS)[number];

export const isStudioEffort = (e: Effort): e is StudioEffort => (STUDIO_EFFORTS as readonly string[]).includes(e);

export const LEVEL_PLANS: Record<StudioEffort, LevelPlan> = {
  refinado: { drafts: 1, polishRounds: 2, gateRepairs: 2, designer: 'fast', designerThinking: 'medium', capUsd: 0.9 },
  // Autoral = o antigo Pro: 2 rascunhos, tudo em Pro, 3 opções de design (o Autoral de 1 rascunho empatou com o Refinado e saiu).
  autoral: { drafts: 2, polishRounds: 2, gateRepairs: 2, designer: 'smart', designerThinking: 'medium', capUsd: 1.2 },
};

// O estúdio usa a mesma lista de modelos do eval (STUDIO_*_MODEL só no eval); em produção os nomes vêm da configuração do Vertex.
export const STUDIO_MODELS: Record<ModelRole, string> = { smart: 'gemini-3.1-pro-preview', fast: 'gemini-3-flash-preview' };

export const SHIP_SCORE = 8;
// Nota mínima do crítico para entregar a peça no Refinado e no Autoral. O Rápido mede 5,8 e o Refinado 8,0 em média (SPEC 030): abaixo de 7 a peça
// não passa de um Rápido mais caro, e o pedido cai no Rápido de verdade. Em staging (30/10) as peças de 6,4 eram claras e quase vazias.
export const MIN_DELIVER_SCORE = 7;
export const MAX_COPY_ROUNDS = 3;

// Quantas vezes o estúdio tenta antes de o pedido cair no Rápido, e quanto pode gastar no total (SPEC 030, decisões 6 e 9). Quem pede
// Refinado ou Autoral quer esse nível: a recusa do portão vira nova tentativa, com as lições da anterior, e só o esgotar das tentativas ou
// do orçamento entrega o Rápido. `typicalUsd` é o custo de uma tentativa (medido em staging em 30/10): sem esse saldo, não tenta de novo.
export const RETRY_PLANS: Record<StudioEffort, { attempts: number; totalCapUsd: number; typicalUsd: number }> = {
  refinado: { attempts: 2, totalCapUsd: 0.9, typicalUsd: 0.3 },
  autoral: { attempts: 3, totalCapUsd: 1.8, typicalUsd: 0.6 },
};
