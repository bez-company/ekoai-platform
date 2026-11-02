import { describe, it, expect, vi } from 'vitest';
import { initSentry, captureError, flushSentry } from '../platform/src/lib/sentry.ts';

describe('sentry da plataforma', () => {
  it('sem SENTRY_DSN é no-op', async () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(() => captureError(new Error('x'), 'teste', { email: 'a@b.co' })).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });

  // O Next carrega uma cópia de sentry.ts por bundle e o SDK é um só no processo: a segunda cópia não
  // pode chamar `Sentry.init` de novo (o SDK avisa "called more than once").
  it('uma segunda cópia do módulo reaproveita o cliente em vez de chamar init de novo', async () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      initSentry();
      vi.resetModules();
      const second = await import('../platform/src/lib/sentry.ts');
      second.initSentry();
      const twice = warn.mock.calls.filter((c) => String(c[0]).includes('more than once'));
      expect(twice).toHaveLength(0);
    } finally {
      warn.mockRestore();
      delete process.env.SENTRY_DSN;
    }
  });
});
