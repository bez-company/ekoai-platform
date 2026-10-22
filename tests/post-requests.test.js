import { describe, it, expect } from 'vitest';
import { parsePostRequest, wakeWorker, IDEA_MAX } from '../platform/src/lib/post-requests.ts';

describe('pedido de post', () => {
  it('exige a ideia e aceita o tipo opcional', () => {
    expect(parsePostRequest({ idea: '  bolo   pronto ', kind: '' })).toEqual({ ok: true, value: { idea: 'bolo pronto', kind: null } });
    expect(parsePostRequest({ idea: 'x', kind: 'atmosfera' })).toEqual({ ok: true, value: { idea: 'x', kind: 'atmosfera' } });
    expect(parsePostRequest({ idea: '' })).toMatchObject({ ok: false, field: 'idea' });
    expect(parsePostRequest({ idea: 'x'.repeat(IDEA_MAX + 1) })).toMatchObject({ ok: false, field: 'idea' });
    expect(parsePostRequest({ idea: 'x', kind: 'reels' })).toMatchObject({ ok: false, field: 'kind' });
    expect(parsePostRequest(null)).toMatchObject({ ok: false });
  });

  it('acorda o worker com o segredo do cron, sem esperar; sem configuração, só avisa', async () => {
    const calls = [];
    wakeWorker({ APP_BASE_URL: 'https://app.test', CRON_SECRET: 's3' }, async (url, init) => (calls.push({ url, auth: init.headers.authorization }), { ok: true }));
    expect(calls).toEqual([{ url: 'https://app.test/api/cron/generate', auth: 'Bearer s3' }]);
    const none = [];
    wakeWorker({}, async () => (none.push(1), { ok: true }));
    expect(none).toEqual([]);
    // chamada que falha não derruba o pedido
    expect(() => wakeWorker({ APP_BASE_URL: 'https://app.test', CRON_SECRET: 's3' }, async () => Promise.reject(new Error('down')))).not.toThrow();
  });
});
