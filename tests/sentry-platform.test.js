import { describe, it, expect, vi } from 'vitest';

// O estado do SDK fica fora da fábrica: `vi.resetModules` refaz o módulo mockado, como o Next faz com
// cada bundle, mas o SDK de verdade é um só no processo (serverExternalPackages).
const sdk = vi.hoisted(() => ({ client: undefined, inits: 0 }));
vi.mock('@sentry/node', () => ({
  init: () => {
    sdk.inits += 1;
    sdk.client = {};
  },
  getClient: () => sdk.client,
  linkedErrorsIntegration: () => ({}),
  dedupeIntegration: () => ({}),
  withScope: (fn) => fn({ setTag: () => {}, setExtras: () => {} }),
  captureException: () => {},
  flush: async () => true,
}));

import { initSentry, captureError, flushSentry } from '../platform/src/lib/sentry.ts';

describe('sentry da plataforma', () => {
  it('sem SENTRY_DSN é no-op', async () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(() => captureError(new Error('x'), 'teste', { email: 'a@b.co' })).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
    expect(sdk.inits).toBe(0);
  });

  it('uma segunda cópia do módulo reaproveita o cliente em vez de chamar init de novo', async () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1';
    try {
      initSentry();
      expect(sdk.inits).toBe(1);
      vi.resetModules();
      const second = await import('../platform/src/lib/sentry.ts');
      second.initSentry();
      expect(sdk.inits).toBe(1);
    } finally {
      delete process.env.SENTRY_DSN;
    }
  });
});
