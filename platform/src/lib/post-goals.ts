// post-goals.ts: os objetivos do post (SPEC 017 decisão 6). Puro e sem dependência de servidor: a tela
// Criar post mostra os cartões a partir daqui, e a geração lê a montagem e a dica do prompt.

// O objetivo do post (SPEC 017 decisão 6): o que a pessoa quer, no lugar de "informativo" e
// "atmosfera". A montagem passa a ser decisão interna: `kind` diz quem manda (texto ou imagem);
// null deixa o estrategista escolher. `hint` vai ao prompt para o redator saber o que o post faz.
export const POST_GOALS = ['ensinar', 'produto', 'bastidores', 'novidade', 'promocao', 'prova_social', 'data_comemorativa', 'conversa', 'auto'] as const;
export type PostGoal = (typeof POST_GOALS)[number];

// O que o post pede à pessoa (SPEC 028): `enviar` (manda a alguém), `salvar` (guarda para consultar), `responder`
// (comenta) ou `assistir` (fica e olha, no carrossel desliza). Cada objetivo tem um sinal padrão; o objetivo
// "auto" deixa o estrategista escolher. Só `enviar` e `salvar` levam a chamada de salvar ou enviar na legenda.
export const SIGNALS = ['enviar', 'salvar', 'responder', 'assistir'] as const;
export type Signal = (typeof SIGNALS)[number];

export function isSignal(value: unknown): value is Signal {
  return typeof value === 'string' && (SIGNALS as readonly string[]).includes(value);
}

export const asksToShare = (signal: Signal | null): boolean => signal === 'enviar' || signal === 'salvar';

export const GOALS: Record<PostGoal, { label: string; example: string; kind: 'informativo' | 'atmosfera' | null; hint: string; signal: Signal | null }> = {
  ensinar: { label: 'Ensinar algo', example: '3 jeitos de conservar o bolo', kind: 'informativo', hint: 'ensinar algo útil ao público: dica, passo a passo ou dado', signal: 'salvar' },
  produto: { label: 'Mostrar o produto ou serviço', example: 'O bolo de pote de ninho', kind: 'atmosfera', hint: 'mostrar um produto ou serviço da empresa, com desejo e detalhe', signal: 'assistir' },
  bastidores: { label: 'Bastidores', example: 'Como a massa é feita', kind: 'atmosfera', hint: 'mostrar os bastidores: o processo, a equipe, o dia a dia', signal: 'assistir' },
  novidade: { label: 'Novidade ou aviso', example: 'Abrimos domingo', kind: 'informativo', hint: 'dar uma novidade ou um aviso claro (horário, lançamento, mudança)', signal: 'enviar' },
  promocao: { label: 'Promoção', example: 'Leve 3, pague 2 até sexta', kind: 'informativo', hint: 'anunciar uma promoção; condição e prazo só se estiverem nos fatos', signal: 'enviar' },
  prova_social: { label: 'Prova social', example: 'O que os clientes dizem', kind: 'informativo', hint: 'mostrar prova social (depoimento, avaliação); nunca invente depoimento nem nome de cliente', signal: 'enviar' },
  data_comemorativa: { label: 'Data comemorativa', example: 'Dia das Crianças', kind: null, hint: 'aproveitar uma data comemorativa ligada ao negócio', signal: 'enviar' },
  conversa: { label: 'Conversa com o público', example: 'Qual você prefere?', kind: 'informativo', hint: 'puxar conversa: uma pergunta direta que o público responde nos comentários', signal: 'responder' },
  auto: { label: 'Deixar a Ekoai escolher', example: 'A Ekoai decide pela sequência', kind: null, hint: '', signal: null },
};

export function isPostGoal(value: unknown): value is PostGoal {
  return typeof value === 'string' && (POST_GOALS as readonly string[]).includes(value);
}

