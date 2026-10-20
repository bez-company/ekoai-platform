import { describe, it, expect } from 'vitest';
import { initSentry, captureJobFailure, flushSentry } from '../src/utils/sentry.js';

describe('sentry dos jobs', () => {
  it('sem SENTRY_DSN (ou em branco) não liga e não quebra nada', async () => {
    expect(initSentry({})).toBe(false);
    expect(initSentry({ SENTRY_DSN: '   ' })).toBe(false);
    expect(() => captureJobFailure('weekly-report', new Error('x'))).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });
});
