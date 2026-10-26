// generation-steps.ts: as etapas que a tela "Criando o post" mostra e o estado de cada uma (SPEC 012 R1, SPEC 020).
// Puro: a tela só desenha. A primeira etapa é ler o pedido (instruções sobre a imagem); se o leitor falhar, o
// post segue sem instruções e a etapa conta como passada.

import type { PostProgress } from './post-requests';

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
