// generation-steps.ts: as etapas que a tela "Criando o post" mostra e o estado de cada uma (SPEC 012 R1, SPEC 020).
// Puro: a tela só desenha. A primeira etapa é ler o pedido (instruções sobre a imagem); se o leitor falhar, o
// post segue sem instruções e a etapa conta como passada.

import type { PostProgress } from './post-requests';
import { AGENT_NODES, levelOf, type Effort } from './studio/levels';

export type StepState = 'done' | 'run' | 'fail' | 'todo';

export const STEPS: { id: string; title: string; sub: string }[] = [
  { id: 'directives', title: 'Lendo o pedido', sub: 'Fundo, posição do logo, texto exato e o que não colocar.' },
  { id: 'writer', title: 'Pensando o tema e escrevendo', sub: 'Estrategista e redator, na voz da empresa, com o revisor conferindo.' },
  { id: 'visual', title: 'Desenhando a imagem', sub: 'No post de atmosfera, o visual é gerado; no informativo, a imagem sai do layout da marca.' },
  { id: 'render', title: 'Montando o post', sub: 'Texto, logo e cores da marca, conferidos: contraste, tamanho e margem.' },
];

export function stateOf(progress: PostProgress, stepId: string): StepState {
  const done = new Set(progress.steps.filter((s) => s.status === 'done').map((s) => s.step));
  const failed = new Set(progress.steps.filter((s) => s.status === 'failed').map((s) => s.step));
  if (progress.status === 'ready') return 'done';
  // Ler o pedido já passou quando deu certo, falhou (o post segue sem instruções) ou o redator já começou.
  const readPassed = done.has('directives') || failed.has('directives') || progress.steps.some((s) => s.step === 'writer');
  if (stepId === 'directives') {
    if (readPassed) return 'done';
    return progress.status === 'generating' ? 'run' : 'todo';
  }
  if (stepId === 'visual' && progress.kind === 'informativo') return done.has('writer') ? 'done' : 'todo';
  if (failed.has(stepId as never) && progress.status === 'failed') return 'fail';
  if (done.has(stepId as never)) return 'done';
  if (progress.status === 'failed') return stepId === 'render' && done.has('writer') && (done.has('visual') || progress.kind === 'informativo') ? 'fail' : 'todo';
  if (progress.status === 'generating') {
    if (stepId === 'writer') return readPassed ? 'run' : 'todo';
    if (stepId === 'visual' && done.has('writer')) return 'run';
    if (stepId === 'render' && done.has('writer') && (done.has('visual') || progress.kind === 'informativo')) return 'run';
  }
  return 'todo';
}

// ── Estúdio (SPEC 030 F3c): os agentes do Refinado e do Autoral ─────────────────────────────────────────────
// A etapa que o job está rodando (nome do pipeline) e o agente que ela acende em AGENT_NODES.
const STAGE_NODE: Record<string, number> = { marketing: 0, diretor: 0, redator: 1, arte: 2, imagens: 2, designer: 3, critico: 4, embelezador: 5, revisor: 6, 'conserto-final': 6 };

const NODE_SUB = ['Achando o ângulo do post e a rota criativa.', 'Escrevendo título e legenda na voz da empresa.', 'Definindo composição, cores, tipografia e imagens.', 'Montando o post em HTML e medindo margem, contraste e tamanho.', 'Avaliando o resultado como um diretor de arte.', 'Corrigindo os detalhes que o crítico apontou.', 'Conferindo texto, marca e fatos antes de ir para Aprovar.'];

export type StudioStep = { id: string; title: string; sub: string; state: StepState };

// Os agentes que trabalham no nível, na ordem, cada um feito, rodando ou por fazer. Sem etapa registrada ainda, o primeiro corre.
export function studioSteps(effort: Effort, stage: string | null, status: PostProgress['status']): StudioStep[] {
  const lit = levelOf(effort).lit;
  const current = stage != null && stage in STAGE_NODE ? STAGE_NODE[stage] : lit[0];
  return lit.map((node) => ({
    id: `studio-${node}`,
    title: AGENT_NODES[node],
    sub: NODE_SUB[node],
    state: status === 'ready' ? 'done' : status === 'failed' ? (node < current ? 'done' : node === current ? 'fail' : 'todo') : node < current ? 'done' : node === current ? 'run' : 'todo',
  }));
}

// A frase de tempo da tela: o nível diz quanto leva (o Rápido segue com a frase de sempre).
export function timeSentence(effort: Effort): string {
  return effort === 'instantaneo' ? 'Leva cerca de 1 minuto.' : `Leva ${levelOf(effort).time}.`;
}
