import { describe, it, expect, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry, captureError, flushSentry } from '../platform/src/lib/sentry.ts';

describe('sentry da plataforma', () => {
  it('sem SENTRY_DSN é no-op', async () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(() => captureError(new Error('x'), 'teste', { email: 'a@b.co' })).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });

  it('uma segunda cópia do módulo reaproveita o cliente em vez de chamar init de novo', async () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1';
    try {
      const first = await import('../platform/src/lib/sentry.ts');
      first.initSentry();
      const client = Sentry.getClient();
      expect(client).toBeDefined();
      vi.resetModules();
      const second = await import('../platform/src/lib/sentry.ts');
      expect(second).not.toBe(first);
      second.initSentry();
      expect(Sentry.getClient()).toBe(client);
    } finally {
      await Sentry.close();
      delete process.env.SENTRY_DSN;
    }
  });
});
