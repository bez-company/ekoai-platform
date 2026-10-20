import { describe, it, expect } from 'vitest';
import { initSentry, captureError, flushSentry } from '../platform/src/lib/sentry.ts';

describe('sentry da plataforma', () => {
  it('sem SENTRY_DSN é no-op', async () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(() => captureError(new Error('x'), 'teste', { email: 'a@b.co' })).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });
});
