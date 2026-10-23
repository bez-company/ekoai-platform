// errors.ts: o que pode e o que não pode chegar na tela. UserError carrega uma mensagem
// escrita para quem usa (o que houve e o próximo passo). Qualquer outro erro é técnico:
// vai inteiro para o log e a tela recebe uma mensagem neutra.

export class UserError extends Error {}
// O que a pessoa pediu não existe (404) ou colide com o estado atual (409). Continuam sendo UserError: a
// mensagem chega à tela; só o status da rota muda.
export class NotFoundError extends UserError {}
export class ConflictError extends UserError {}

export const GENERIC_ERROR = 'Não deu para concluir agora. Tente de novo em instantes; se continuar, avise o suporte.';

export function userMessage(e: unknown): string {
  return e instanceof UserError ? e.message : GENERIC_ERROR;
}
