// publish-mode.ts: o ambiente publica de verdade ou ensaia. Em ensaio o app cria o container na Meta, espera
// ele ficar pronto (isso valida imagem, legenda, token e permissão) e NÃO chama media_publish: nada vai ao ar.
// O padrão é `live`. Valor desconhecido falha alto, porque errar para `live` num ambiente de teste posta em
// perfil real. Puro, sem I/O.

export type PublishMode = 'live' | 'rehearsal';

export function publishMode(env: Record<string, string | undefined> = process.env): PublishMode {
  const value = env.PUBLISH_MODE?.trim();
  if (!value || value === 'live') return 'live';
  if (value === 'rehearsal') return 'rehearsal';
  throw new Error(`PUBLISH_MODE inválido: "${value}". Use "live" ou "rehearsal".`);
}

// Id que o ensaio devolve no lugar do id do post: nunca é um id da Meta, então nada consulta métrica com ele.
export const REHEARSAL_ID_PREFIX = 'rehearsal:';
export const rehearsalId = (ref: string) => `${REHEARSAL_ID_PREFIX}${ref}`;
export const isRehearsalResult = (result: Record<string, unknown>) => result.rehearsal === true;
