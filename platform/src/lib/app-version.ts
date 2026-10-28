// Versão do app em execução: a revisão do Cloud Run (K_REVISION), ou APP_VERSION se o deploy a definir.
// Fora do Cloud Run vale 'dev', e aí ninguém é avisado de versão nova (não há deploy para comparar).

export function appVersion(): string {
  return process.env.APP_VERSION?.slice(0, 7) ?? process.env.K_REVISION ?? 'dev';
}

/** O servidor roda outra versão que a da página aberta? Sem versão local de deploy ('dev') ou sem resposta, não. */
export function hasNewVersion(local: string, remote: unknown): boolean {
  if (local === 'dev') return false;
  return typeof remote === 'string' && remote !== '' && remote !== local;
}
