import { describe, it, expect, vi, afterEach } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { track, resetAnalyticsForTests } from '../platform/src/lib/analytics.ts';

afterEach(() => {
  delete process.env.POSTHOG_KEY;
  resetAnalyticsForTests();
  vi.restoreAllMocks();
});

describe('analytics da plataforma', () => {
  it('sem POSTHOG_KEY (ou em branco, como o placeholder do Secret Manager) é no-op', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(track('acme', 'post_approved')).resolves.toBeUndefined();
    process.env.POSTHOG_KEY = ' ';
    resetAnalyticsForTests();
    await expect(track('acme', 'post_approved')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('com a chave, manda o evento da conta sem dado de pessoa', async () => {
    process.env.POSTHOG_KEY = 'phc_test';
    process.env.SENTRY_ENVIRONMENT = 'production';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":1}', { status: 200 }));
    await track('acme', 'post_published', { channel: 'instagram' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('us.i.posthog.com');
    // O SDK manda o lote comprimido (gzip).
    const raw = Buffer.from(await new Response(init.body).arrayBuffer());
    const body = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString() : raw.toString();
    expect(body).toContain('tenant:acme');
    expect(body).toContain('post_published');
    expect(body).toContain('instagram');
    expect(body).not.toMatch(/@/);
    delete process.env.SENTRY_ENVIRONMENT;
  });

  it('falha de rede vira aviso e não derruba quem chamou', async () => {
    process.env.POSTHOG_KEY = 'phc_test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(track('acme', 'signed_in')).resolves.toBeUndefined();
  });
});
