import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { oauthHeader, publishThread, uploadVideoFromUrl, replyWithLink } from '../platform/src/lib/channels/x.ts';
import { splitThread } from '../platform/src/lib/thread.ts';
import { splitThread as splitThreadNode } from '../src/channels/twitter.js';
import { LINK_POLICY, distributionUtm } from '../platform/src/lib/utm.ts';

const ENV = {
  X_API_KEY: 'k',
  X_API_SECRET: 's',
  X_ACCESS_TOKEN: 't',
  X_ACCESS_TOKEN_SECRET: 'ts',
};

// Fila de respostas falsas; registra cada chamada pra inspeção.
function mockFetch(responses) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    const r = responses.shift();
    if (!r) throw new Error(`chamada inesperada: ${url}`);
    if (r.binary) {
      return new Response(new Uint8Array(r.binary), { status: 200, headers: { 'content-type': r.type || 'image/png' } });
    }
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('oauthHeader', () => {
  // Exemplo oficial de "Creating a signature" da documentação do X.
  it('bate com a assinatura do exemplo oficial', () => {
    const header = oauthHeader({
      method: 'POST',
      url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
      creds: {
        apiKey: 'xvz1evFS4wEEPTGEFPHBog',
        apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
      },
      extraParams: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      timestamp: '1318622958',
    });
    expect(header).toContain(`oauth_signature="${encodeURIComponent('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')}"`);
  });
});

describe('splitThread (plataforma)', () => {
  it('é igual ao do pipeline Node', () => {
    const long = Array.from({ length: 6 }, (_, i) => `Parágrafo ${i} ${'palavra '.repeat(12)}fim.`).join('\n\n');
    for (const text of ['', 'curto', long, `${'Frase longa demais. '.repeat(30)}`]) {
      expect(splitThread(text)).toEqual(splitThreadNode(text));
    }
  });
});

describe('publishThread', () => {
  it('encadeia cada tweet como resposta ao anterior, mídia só no primeiro', async () => {
    const calls = mockFetch([
      { binary: [1, 2, 3] }, // download da arte
      { json: { data: { id: 'm1' } } }, // upload
      { json: { data: { id: '100' } } },
      { json: { data: { id: '101' } } },
      { json: { data: { id: '102' } } },
    ]);
    const r = await publishThread({ tweets: ['um', 'dois', 'três'], imageUrl: 'https://cdn/arte.png' });

    expect(r).toMatchObject({ id: '100', ids: ['100', '101', '102'], url: 'https://x.com/i/status/100', media_id: 'm1' });
    const posts = calls.filter((c) => c.url.endsWith('/2/tweets')).map((c) => JSON.parse(c.body));
    expect(posts[0]).toEqual({ text: 'um', media: { media_ids: ['m1'] } });
    expect(posts[1]).toEqual({ text: 'dois', reply: { in_reply_to_tweet_id: '100' } });
    expect(posts[2]).toEqual({ text: 'três', reply: { in_reply_to_tweet_id: '101' } });
    expect(calls[1].headers.Authorization).toMatch(/^OAuth oauth_consumer_key="k"/);
  });

  it('falha no 1º tweet lança (nada saiu, retry é seguro)', async () => {
    mockFetch([{ status: 403, json: { detail: 'forbidden' } }]);
    await expect(publishThread({ tweets: ['um', 'dois'] })).rejects.toThrow(/X API 403/);
  });

  it('falha depois do 1º vira partial_error, sem lançar', async () => {
    mockFetch([{ json: { data: { id: '100' } } }, { status: 429, json: { title: 'Too Many Requests' } }]);
    const r = await publishThread({ tweets: ['um', 'dois'] });
    expect(r.ids).toEqual(['100']);
    expect(r.partial_error).toMatch(/429/);
  });

  it('recusa tweet acima de 280 antes de chamar a API', async () => {
    const calls = mockFetch([]);
    await expect(publishThread({ tweets: ['x'.repeat(281)] })).rejects.toThrow(/281 caracteres/);
    expect(calls).toHaveLength(0);
  });

  it('diz qual credencial falta', async () => {
    vi.stubEnv('X_ACCESS_TOKEN_SECRET', '');
    mockFetch([]);
    await expect(publishThread({ tweets: ['um'] })).rejects.toThrow(/X_ACCESS_TOKEN_SECRET/);
  });
});

describe('uploadVideoFromUrl', () => {
  it('faz initialize, append, finalize e espera o processamento', async () => {
    const calls = mockFetch([
      { binary: [9, 9, 9, 9], type: 'video/mp4' },
      { json: { data: { id: 'v1' } } },
      { json: { data: { expires_at: 1 } } },
      { json: { data: { id: 'v1', processing_info: { state: 'pending', check_after_secs: 0 } } } },
      { json: { data: { id: 'v1', processing_info: { state: 'succeeded' } } } },
    ]);
    await expect(uploadVideoFromUrl('https://cdn/v.mp4')).resolves.toBe('v1');
    expect(JSON.parse(calls[1].body)).toEqual({ media_type: 'video/mp4', total_bytes: 4, media_category: 'tweet_video' });
    expect(calls[2].url).toMatch(/\/media\/upload\/v1\/append$/);
    expect(calls[3].url).toMatch(/\/media\/upload\/v1\/finalize$/);
    expect(calls[4].url).toMatch(/command=STATUS&media_id=v1$/);
  });

  it('vídeo recusado no processamento lança', async () => {
    mockFetch([
      { binary: [1], type: 'video/mp4' },
      { json: { data: { id: 'v2' } } },
      { json: {} },
      { json: { data: { processing_info: { state: 'failed', error: { message: 'codec' } } } } },
    ]);
    await expect(uploadVideoFromUrl('https://cdn/v.mp4')).rejects.toThrow(/codec/);
  });
});

describe('link no X', () => {
  it('política é resposta e utm_source é x', () => {
    expect(LINK_POLICY.twitter).toBe('reply');
    const utm = distributionUtm({ channel: 'twitter', distributionId: '3f2a9c1e-7b4d-4e2a-9c11-aa00bb11cc22', baseUrl: 'https://exemplo.com.br' });
    expect(utm.source).toBe('x');
    expect(utm.url).toContain('utm_source=x');
  });

  it('replyWithLink responde ao tweet indicado', async () => {
    const calls = mockFetch([{ json: { data: { id: '200' } } }]);
    await expect(replyWithLink('102', 'link')).resolves.toEqual({ id: '200' });
    expect(JSON.parse(calls[0].body)).toEqual({ text: 'link', reply: { in_reply_to_tweet_id: '102' } });
  });
});
