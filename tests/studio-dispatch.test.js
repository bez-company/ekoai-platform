import { describe, it, expect } from 'vitest';
import { dispatchStudioJob, needsStudioJob, studioJobName } from '../platform/src/lib/studio/dispatch.ts';

const NAME = 'projects/ekoai-staging/locations/southamerica-east1/jobs/ekoai-studio';

describe('disparo do job do estúdio', () => {
  it('só o Refinado e o Autoral passam pelo job', () => {
    expect(['instantaneo', 'refinado', 'autoral', 'pro', undefined].map(needsStudioJob)).toEqual([false, true, true, false, false]);
  });

  it('o nome do job vem de STUDIO_JOB_NAME e só vale no formato do Cloud Run', () => {
    expect(studioJobName({ STUDIO_JOB_NAME: NAME })).toBe(NAME);
    expect(studioJobName({})).toBeNull();
    expect(studioJobName({ STUDIO_JOB_NAME: 'ekoai-studio' })).toBeNull();
    expect(studioJobName({ STUDIO_JOB_NAME: 'projects/x/locations/y/jobs/z; rm -rf' })).toBeNull();
  });

  it('pede a execução com a conta e o pedido nas variáveis do contêiner', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    };
    await dispatchStudioJob(NAME, { tenantId: 'acme', briefId: 'b-1' }, { fetchImpl, token: async () => 'tok' });
    expect(calls[0].url).toBe(`https://run.googleapis.com/v2/${NAME}:run`);
    expect(calls[0].init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body).overrides.containerOverrides[0].env).toEqual([{ name: 'STUDIO_TENANT', value: 'acme' }, { name: 'STUDIO_BRIEF', value: 'b-1' }]);
  });

  it('resposta de erro lança com o status, para o worker cair no caminho de sempre', async () => {
    const fetchImpl = async () => new Response('permission denied', { status: 403 });
    await expect(dispatchStudioJob(NAME, { tenantId: 'acme', briefId: 'b-1' }, { fetchImpl, token: async () => 'tok' })).rejects.toThrow(/403/);
  });
});
