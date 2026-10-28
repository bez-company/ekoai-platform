// generation-errors.ts: o erro de uma geração vira uma frase de gente na tela de andamento (BEZ-291). O detalhe técnico
// fica no log do servidor. Puro, para o teste cobrir cada família de erro.

const OUR_FAULT = 'Não deu para gerar agora, o problema é nosso. Tente de novo em instantes; se continuar, avise o suporte.';

// O modelo recusou por política de conteúdo (finishReason). Só nesse caso a frase pede outro tema.
const SAFETY = /\((?:IMAGE_)?SAFETY\)|PROHIBITED_CONTENT|BLOCKLIST|SPII|IMAGE_PROHIBITED|RECITATION/;

export function friendlyGenerationError(error: string | null): string {
  if (!error) return 'Algo deu errado no meio do caminho.';
  if (/Vertex AI (429|503)/.test(error)) return 'O modelo de imagem está sobrecarregado agora. Em alguns minutos costuma voltar.';
  if (SAFETY.test(error)) return 'O modelo recusou o pedido. Tente outro tema ou outra direção.';
  // 404 (modelo que não existe) e 403 (permissão) são configuração nossa; 400 e demais 4xx também: tentar outro tema não resolve.
  if (/Vertex AI [45]\d\d/.test(error)) return OUR_FAULT;
  if (/perfil da empresa/i.test(error)) return error;
  return error.length > 160 ? `${error.slice(0, 160)}…` : error;
}
