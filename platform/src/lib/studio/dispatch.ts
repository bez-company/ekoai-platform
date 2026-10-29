// dispatch.ts: o worker de geração dispara a execução do Cloud Run Job do estúdio (SPEC 030 F3c, ADR 0028). Uma execução por pedido; o
// pedido continua "em geração" e o job bate o coração. O nome do job vem de STUDIO_JOB_NAME (projects/<p>/locations/<r>/jobs/<nome>);
// sem ele o estúdio fica desligado e o worker gera tudo pelo caminho de sempre.

import { adcToken } from '../vertex';

// Os níveis que passam pelo job. O Rápido segue pelo worker (modelo pronto ou motor atual).
export const STUDIO_JOB_EFFORTS = ['refinado', 'autoral'] as const;
export const needsStudioJob = (effort: unknown): boolean => (STUDIO_JOB_EFFORTS as readonly string[]).includes(String(effort));

export type DispatchDeps = { fetchImpl?: typeof fetch; token?: () => Promise<string> };

export function studioJobName(env: Record<string, string | undefined> = process.env): string | null {
  const name = env.STUDIO_JOB_NAME?.trim();
  return name && /^projects\/[\w-]+\/locations\/[\w-]+\/jobs\/[\w-]+$/.test(name) ? name : null;
}

// Pede a execução com o pedido e a conta nas variáveis do contêiner. Falha de rede ou de permissão lança: quem chama gera pelo caminho de sempre.
export async function dispatchStudioJob(jobName: string, input: { tenantId: string; briefId: string }, deps: DispatchDeps = {}): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = await (deps.token ?? adcToken)();
  const res = await fetchImpl(`https://run.googleapis.com/v2/${jobName}:run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: 'STUDIO_TENANT', value: input.tenantId }, { name: 'STUDIO_BRIEF', value: input.briefId }] }], taskCount: 1 } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Cloud Run ${res.status} ao disparar o job do estúdio: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
