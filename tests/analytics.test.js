import { describe, it, expect, vi, afterEach } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { track, resetAnalyticsForTests, sanitizeProps } from '../platform/src/lib/analytics.ts';
import { costByStep } from '../platform/src/lib/product-events.ts';

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
    await track('acme', 'published_success', { channel: 'instagram' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('us.i.posthog.com');
    // O SDK manda o lote comprimido (gzip).
    const raw = Buffer.from(await new Response(init.body).arrayBuffer());
    const body = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString() : raw.toString();
    expect(body).toContain('tenant:acme');
    expect(body).toContain('published_success');
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

describe('evento sem dado pessoal (BEZ-260)', () => {
  it('tira da propriedade e-mail, token, texto de post e chave de campo sensível', () => {
    const { safe, dropped } = sanitizeProps({
      step: 'writer',
      count: 3,
      by_email: true,
      brief_id: '0b0c27d4-6256-4aa3-9c8d-a50ee67fd156',
      contact: 'ana@example.com',
      note: 'x'.repeat(61),
      credential: 'a1b2c3d4'.repeat(5), // 40 caracteres seguidos, montado em runtime para não parecer segredo no repo
      caption: 'Promoção de hoje',
      idea: 'bolo',
    });
    expect(safe).toEqual({ step: 'writer', count: 3, by_email: true, brief_id: '0b0c27d4-6256-4aa3-9c8d-a50ee67fd156' });
    expect(dropped.sort()).toEqual(['caption', 'contact', 'credential', 'idea', 'note']);
  });

  it('o evento enviado não leva o que foi removido', async () => {
    process.env.POSTHOG_KEY = 'phc_test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":1}', { status: 200 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await track('acme', 'post_ready', { latency_ms: 1200, contact: 'ana@example.com', caption: 'texto do post' });
    const raw = Buffer.from(await new Response(fetchSpy.mock.calls[0][1].body).arrayBuffer());
    const body = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString() : raw.toString();
    expect(body).toContain('latency_ms');
    expect(body).not.toContain('ana@example.com');
    expect(body).not.toContain('texto do post');
  });

  it('nenhum track() do código nomeia propriedade de dado pessoal', () => {
    const forbidden = /e-?mail|token|secret|password|senha|caption|legenda|text|idea|ideia|name|nome|body|hashtag|phone|telefone|cpf|cnpj/i;
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry)) files.push(path);
      }
    };
    walk('platform/src');
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const call of source.matchAll(/\btrack\(\s*[^,]+,\s*['"`]\w+['"`]\s*,\s*\{([^}]*)\}/g)) {
        for (const key of call[1].matchAll(/(?:^|,)\s*(\w+)\s*[:,]/g)) {
          if (key[1] === 'by_email') continue; // booleano (se o convite saiu por e-mail), não o endereço
          if (forbidden.test(key[1])) offenders.push(`${file}: ${key[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a publicação emite published_success e published_failure, com motivo em classe e nunca a mensagem', () => {
    const publish = readFileSync('platform/src/lib/publish.ts', 'utf8');
    expect(publish).toContain("'published_success'");
    expect(publish).toContain("'published_failure'");
    expect(publish).not.toMatch(/'post_published'|'post_publish_failed'/);
    const reasons = [...publish.matchAll(/'published_failure',\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    for (const call of reasons) expect(call).not.toMatch(/msg|message|detail|error:/);
  });
});

describe('custo por etapa', () => {
  it('soma chamadas por etapa, conta falha e arredonda o custo', () => {
    const rows = [
      { step: 'writer', status: 'done', cost_usd: '0.001200', duration_ms: 900, input_tokens: 1000, output_tokens: 200, images: 0 },
      { step: 'writer', status: 'failed', cost_usd: null, duration_ms: null, input_tokens: null, output_tokens: null, images: null },
      { step: 'visual', status: 'done', cost_usd: 0.039, duration_ms: 8000, input_tokens: 300, output_tokens: 1290, images: 1 },
    ];
    expect(costByStep(rows)).toEqual([
      { step: 'writer', calls: 2, failed_calls: 1, cost_usd: 0.0012, duration_ms: 900, input_tokens: 1000, output_tokens: 200, images: 0 },
      { step: 'visual', calls: 1, failed_calls: 0, cost_usd: 0.039, duration_ms: 8000, input_tokens: 300, output_tokens: 1290, images: 1 },
    ]);
    expect(costByStep([])).toEqual([]);
  });
});
