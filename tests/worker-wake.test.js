import { describe, it, expect } from 'vitest';
import { wakeWorkerAndWait } from '../platform/src/lib/worker-wake.ts';

const env = { APP_BASE_URL: 'https://app.test', CRON_SECRET: 's3' };

describe('acordar o worker e esperar (job do estúdio)', () => {
  it('espera a resposta do worker antes de devolver, com o segredo no cabeçalho', async () => {
    let finished = false;
    const fetchImpl = async (url, init) => {
      expect(url).toBe('https://app.test/api/cron/generate');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe('Bearer s3');
      await new Promise((r) => setTimeout(r, 30));
      finished = true;
      return new Response('{}', { status: 200 });
    };
    await wakeWorkerAndWait(env, fetchImpl);
    expect(finished).toBe(true);
  });

  it('sem endereço ou segredo não chama a rede', async () => {
    let called = 0;
    await wakeWorkerAndWait({}, async () => (called += 1, new Response('{}')));
    await wakeWorkerAndWait({ APP_BASE_URL: 'https://app.test' }, async () => (called += 1, new Response('{}')));
    expect(called).toBe(0);
  });

  it('falha de rede, resposta de erro e prazo estourado não lançam', async () => {
    await expect(wakeWorkerAndWait(env, async () => { throw new Error('rede caiu'); })).resolves.toBeUndefined();
    await expect(wakeWorkerAndWait(env, async () => new Response('negado', { status: 401 }))).resolves.toBeUndefined();
    const slow = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('abortado'))));
    await expect(wakeWorkerAndWait(env, slow, 30)).resolves.toBeUndefined();
  });
});
