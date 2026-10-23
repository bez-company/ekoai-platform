import { describe, it, expect } from 'vitest';
import { connectWithRetry, isTransientConnectError } from '../scripts/migrate.js';

const err = (code, message = code) => Object.assign(new Error(message), { code });

function factory(outcomes) {
  const made = [];
  return {
    made,
    make: () => {
      const outcome = outcomes[made.length];
      const c = { ended: false, connect: async () => { if (outcome) throw outcome; }, end: async () => { c.ended = true; } };
      made.push(c);
      return c;
    },
  };
}
const noSleep = { waits: [1, 2, 3], sleep: async () => {}, log: () => {} };

describe('migrate: conexão com o banco sob demanda (BEZ-120)', () => {
  it('erro de rede tenta de novo com cliente novo e segue quando conecta', async () => {
    const f = factory([err('ETIMEDOUT'), err('57P03', 'the database system is starting up'), null]);
    const waited = [];
    const client = await connectWithRetry(f.make, { ...noSleep, sleep: async (ms) => void waited.push(ms) });
    expect(client).toBe(f.made[2]);
    expect(f.made).toHaveLength(3);
    expect(f.made[0].ended && f.made[1].ended).toBe(true);
    expect(waited).toEqual([1, 2]);
  });

  it('esgota as tentativas e devolve o último erro', async () => {
    const f = factory([err('ECONNREFUSED'), err('ECONNREFUSED'), err('ECONNREFUSED'), err('ETIMEDOUT')]);
    await expect(connectWithRetry(f.make, noSleep)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(f.made).toHaveLength(4);
  });

  it('senha errada ou banco inexistente falha na hora, sem esperar', async () => {
    const f = factory([err('28P01', 'password authentication failed')]);
    await expect(connectWithRetry(f.make, noSleep)).rejects.toMatchObject({ code: '28P01' });
    expect(f.made).toHaveLength(1);
  });

  it('o que conta como passageiro', () => {
    expect(isTransientConnectError(err('ETIMEDOUT'))).toBe(true);
    expect(isTransientConnectError(new Error('timeout expired'))).toBe(true);
    expect(isTransientConnectError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientConnectError(err('3D000', 'database "x" does not exist'))).toBe(false);
    expect(isTransientConnectError(null)).toBe(false);
  });
});
