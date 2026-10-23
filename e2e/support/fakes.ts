// fakes.ts: o que o app chamaria fora (Vertex AI, Cloud KMS, Meta) e o token da conta de serviço,
// simulados num servidor local. Sobe no global-setup; os specs inspecionam as chamadas e programam
// falhas por `/__fake/*`. Nada daqui fala com a internet, e nenhuma credencial é real.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { FAKES_PORT } from './env';

export type FakeCall = { host: string; method: string; path: string; body: unknown };

// Resposta do modelo de texto para um post informativo (a mesma que os testes de banco usam).
export const FAKE_POST = {
  kind: 'informativo',
  angle: 'dica',
  texts: {
    kicker: 'Dica da casa',
    title: 'Seu bolo está pronto?',
    sub: 'Confira sem abrir o forno',
    items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'],
  },
  caption: 'Bolo bom não tem pressa. Três sinais para conferir. Chame no WhatsApp.',
  hashtags: ['bolo', 'marilia'],
};

export const FAKE_PHOTO_DESCRIPTION = { description: 'Bolo de cenoura com cobertura de chocolate sobre uma mesa de madeira', tags: ['produto'], has_people: false };
export const FAKE_PHOTO_CAPTION = { caption: 'Cenoura com chocolate, do forno para a sua mesa. Encomende pelo WhatsApp.', hashtags: ['bolodecenoura', 'confeitaria'] };

const FAKE_PROFILE = { user_id: '17841400000000001', username: 'doceponto.teste', account_type: 'BUSINESS' };

type Failure = { host: string; status: number; remaining: number };

export function startFakes(): Promise<{ server: Server; close: () => Promise<void> }> {
  const calls: FakeCall[] = [];
  let failures: Failure[] = [];
  let counter = 0;

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return Object.fromEntries(new URLSearchParams(text));
    }
  }

  function vertex(path: string, body: any, res: ServerResponse) {
    const wantsImage = Array.isArray(body?.generationConfig?.responseModalities);
    if (wantsImage) {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      return json(res, 200, {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 1120 },
        modelVersion: 'fake-image-1',
      });
    }
    // O app diz a etapa nos labels da chamada: cada uma espera um JSON de formato próprio.
    const step = body?.labels?.step;
    const reply = step === 'media_describe' ? FAKE_PHOTO_DESCRIPTION : step === 'photo_caption' || step === 'photo_rewrite' ? FAKE_PHOTO_CAPTION : FAKE_POST;
    json(res, 200, {
      candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      modelVersion: 'fake-text-1',
    });
  }

  function kms(path: string, body: any, res: ServerResponse) {
    // Não cifra de verdade: devolve o mesmo conteúdo em base64, o suficiente para o app gravar e reler.
    if (path.endsWith(':encrypt')) return json(res, 200, { name: `${path.slice(0, -':encrypt'.length)}/cryptoKeyVersions/1`, ciphertext: body.plaintext });
    if (path.endsWith(':decrypt')) return json(res, 200, { plaintext: body.ciphertext });
    json(res, 404, { error: { message: 'rota do KMS não simulada' } });
  }

  function meta(host: string, path: string, method: string, url: URL, body: any, res: ServerResponse) {
    if (host === 'api.instagram.com' && path === '/oauth/access_token') {
      return json(res, 200, { access_token: 'short-lived-fake', user_id: FAKE_PROFILE.user_id, permissions: ['instagram_business_basic', 'instagram_business_content_publish'] });
    }
    if (path === '/access_token' || path === '/refresh_access_token') return json(res, 200, { access_token: 'long-lived-fake', token_type: 'bearer', expires_in: 5_184_000 });
    if (/\/me$/.test(path)) return json(res, 200, { id: FAKE_PROFILE.user_id, ...FAKE_PROFILE });
    if (method === 'POST' && /\/media_publish$/.test(path)) return json(res, 200, { id: `fake-media-${(counter += 1)}` });
    if (method === 'POST' && /\/media$/.test(path)) return json(res, 200, { id: `fake-container-${(counter += 1)}` });
    if (url.searchParams.get('fields')?.includes('status_code')) return json(res, 200, { status_code: 'FINISHED', id: path.split('/').pop() });
    if (url.searchParams.get('fields')?.includes('permalink')) return json(res, 200, { id: path.split('/').pop(), permalink: 'https://www.instagram.com/p/FAKE/' });
    if (/\/media$/.test(path)) return json(res, 200, { data: [] });
    json(res, 200, { id: path.split('/').pop() });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');

    // Admin dos specs.
    if (url.pathname === '/__fake/calls') return json(res, 200, calls);
    if (url.pathname === '/__fake/reset') {
      calls.length = 0;
      failures = [];
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__fake/fail') {
      const { host, status = 500, times = 1 } = (await readBody(req)) as { host: string; status?: number; times?: number };
      failures.push({ host, status, remaining: times });
      return json(res, 200, { ok: true });
    }

    // Token da conta de serviço (servidor de metadados do GCE): o app pede para Vertex e KMS.
    if (url.pathname.startsWith('/computeMetadata/')) {
      const headers = { 'metadata-flavor': 'Google' };
      if (url.pathname.endsWith('/token')) return json(res, 200, { access_token: 'fake-service-account-token', expires_in: 3600, token_type: 'Bearer' }, headers);
      return json(res, 200, {}, headers);
    }

    const match = /^\/@([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return json(res, 404, { error: 'rota não simulada' });
    const [, host, path = '/'] = match;
    const body = await readBody(req);
    calls.push({ host, method: req.method ?? 'GET', path: path + url.search, body });

    const failure = failures.find((f) => f.host === host && f.remaining > 0);
    if (failure) {
      failure.remaining -= 1;
      return json(res, failure.status, { error: { message: 'falha programada pelo teste', code: failure.status } });
    }

    if (/aiplatform\.googleapis\.com$/.test(host)) return vertex(path, body, res);
    if (host === 'cloudkms.googleapis.com') return kms(path, body, res);
    if (/instagram\.com$|facebook\.com$/.test(host)) return meta(host, path, req.method ?? 'GET', url, body, res);
    json(res, 404, { error: 'host não simulado' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(FAKES_PORT, '127.0.0.1', () =>
      resolve({ server, close: () => new Promise<void>((done) => server.close(() => done())) }),
    );
  });
}

// Lado do spec: lê e limpa o registro de chamadas do servidor simulado.
export async function fakeCalls(host?: RegExp): Promise<FakeCall[]> {
  const res = await fetch(`http://127.0.0.1:${FAKES_PORT}/__fake/calls`);
  const all = (await res.json()) as FakeCall[];
  return host ? all.filter((c) => host.test(c.host)) : all;
}

export async function resetFakes() {
  await fetch(`http://127.0.0.1:${FAKES_PORT}/__fake/reset`);
}

export async function failFake(host: string, status = 500, times = 1) {
  await fetch(`http://127.0.0.1:${FAKES_PORT}/__fake/fail`, { method: 'POST', body: JSON.stringify({ host, status, times }) });
}
