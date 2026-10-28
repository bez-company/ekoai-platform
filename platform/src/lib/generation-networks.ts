// generation-networks.ts: as linhas da tela "Gerando" quando o pedido tem mais de uma rede (SPEC 028, BEZ-437): o núcleo da
// ideia, uma linha por rede e a avaliação, cada uma com o estado dela. Puro: a tela só desenha. A rede que falha não derruba as
// outras: as demais ficam prontas e só ela oferece "Tentar de novo".

import type { Channel } from './types';
import type { StepState } from './generation-steps';

export type NetworkRowId = 'core' | Channel | 'review';
export type NetworkRow = { id: NetworkRowId; title: string; sub: string; state: StepState; error: string | null; canRetry: boolean };

export type NetworkRowsInput = {
  status: 'queued' | 'generating' | 'ready' | 'failed';
  channels: readonly Channel[];
  coreDone: boolean; // o redator já devolveu o núcleo (ou o post já está pronto)
  pendingChannels: readonly Channel[]; // as redes que já viraram pendência em Aprovar
  errors: Partial<Record<Channel, string>>; // a última falha de cada rede
};

const LABEL: Record<Channel, { title: string; sub: string; failed: string }> = {
  instagram: { title: 'Instagram: legenda e imagem', sub: 'Legenda com a chamada que combina com o objetivo, e a arte da marca.', failed: 'Não deu para criar o post do Instagram agora.' },
  linkedin: { title: 'LinkedIn: texto', sub: 'Texto em primeira pessoa, com abertura forte e uma pergunta para quem é do ramo.', failed: 'Não deu para escrever o post do LinkedIn agora. As outras redes estão prontas.' },
  twitter: { title: 'X: post de até 280 caracteres', sub: 'Um post próprio, com um motivo para responder.', failed: 'Não deu para escrever o post do X agora. As outras redes estão prontas.' },
};

// Só o LinkedIn tem "Tentar de novo" por rede por enquanto (o X ainda não é gerado).
const RETRYABLE: readonly Channel[] = ['linkedin'];

export function networkRows(input: NetworkRowsInput): NetworkRow[] {
  const { status, channels, pendingChannels, errors } = input;
  const ready = status === 'ready';
  const generating = status === 'generating';
  const coreDone = input.coreDone || ready;

  const rows: NetworkRow[] = [
    { id: 'core', title: 'Núcleo da ideia', sub: 'Ângulo, pontos e o fato que sustenta o post.', state: coreDone ? 'done' : generating ? 'run' : 'todo', error: null, canRetry: false },
  ];

  let previousDone = coreDone;
  for (const channel of channels) {
    const has = pendingChannels.includes(channel);
    const error = errors[channel] ?? null;
    // O Instagram é escrito junto do núcleo e o resto depois dele: uma rede "em andamento" é a primeira que ainda não acabou.
    let state: StepState = has ? 'done' : error ? 'fail' : ready ? 'fail' : status === 'failed' ? 'todo' : generating && previousDone ? 'run' : 'todo';
    if (status === 'failed' && !has && !error) state = channel === channels[0] && !coreDone ? 'fail' : 'todo';
    rows.push({ id: channel, title: LABEL[channel].title, sub: state === 'fail' ? LABEL[channel].failed : LABEL[channel].sub, state, error: state === 'fail' ? error : null, canRetry: state === 'fail' && ready && RETRYABLE.includes(channel) });
    previousDone = previousDone && (state === 'done' || state === 'fail');
  }

  const settled = rows.slice(1).every((r) => r.state === 'done' || r.state === 'fail');
  rows.push({
    id: 'review',
    title: 'Avaliação por rede',
    sub: 'Cada post é conferido contra o que a rede mede, com sugestões onde o potencial é médio ou fraco.',
    state: ready ? 'done' : generating && settled ? 'run' : 'todo',
    error: null,
    canRetry: false,
  });
  return rows;
}

// A rede que falhou num pedido que está pronto: a tela avisa e oferece "Tentar de novo" só nela.
export const failedNetworks = (rows: readonly NetworkRow[]): NetworkRow[] => rows.filter((r) => r.state === 'fail' && r.id !== 'core' && r.id !== 'review');
