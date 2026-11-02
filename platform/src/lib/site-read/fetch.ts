// fetch.ts: busca de uma página pública (SPEC 033, BEZ-525). O transporte padrão abre a conexão por `node:https` com um `lookup` próprio: o
// endereço que o DNS devolve é conferido NA HORA de conectar, então um nome que aponta para IP interno (inclusive o truque de responder
// um IP público na conferência e outro na conexão) não passa. Cada redirecionamento volta pelas mesmas regras. Sem cookie, sem
// compressão (nada de arquivo que explode), 2 MB e 10 s.

import dns from 'node:dns';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { SITE_USER_AGENT, fetchableUrl, isPublicAddress } from './url-guard';

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const REQUEST_TIMEOUT_MS = 10_000;

export type RawResponse = { status: number; location: string | null; contentType: string; body: Buffer };
export type Transport = (url: URL, o: { accept: string; signal: AbortSignal }) => Promise<RawResponse>;

// Falhas que a tela explica com uma frase; quem usa traduz o `kind`.
export type ReadFailKind = 'blocked' | 'timeout' | 'network' | 'too-big' | 'redirects' | 'status' | 'type';
export class ReadFailure extends Error {
  constructor(readonly kind: ReadFailKind, message: string, readonly status?: number) {
    super(message);
  }
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) return callback(new ReadFailure('blocked', 'endereço não público'), '', 0);
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

export const httpsTransport: Transport = (url, { accept, signal }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ReadFailure('timeout', 'tempo esgotado'));
    const req = https.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: guardedLookup,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'user-agent': SITE_USER_AGENT, accept, 'accept-encoding': 'identity', 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) return req.destroy(new ReadFailure('too-big', 'resposta grande demais'));
          chunks.push(chunk);
        });
        res.on('end', () => {
          const type = res.headers['content-type'];
          const location = res.headers.location;
          resolve({ status: res.statusCode ?? 0, location: typeof location === 'string' ? location : null, contentType: (typeof type === 'string' ? type : '').toLowerCase(), body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    const onAbort = () => req.destroy(new ReadFailure('timeout', 'tempo esgotado'));
    signal.addEventListener('abort', onAbort, { once: true });
    req.on('timeout', onAbort);
    req.on('error', (e) => reject(e));
    req.on('close', () => signal.removeEventListener('abort', onAbort));
    req.end();
  });

function classify(e: unknown): ReadFailure {
  if (e instanceof ReadFailure) return e;
  const cause = (e as { cause?: unknown })?.cause;
  if (cause instanceof ReadFailure) return cause;
  return new ReadFailure('network', e instanceof Error ? e.message : 'falha de rede');
}

export type Fetched = { url: URL; status: number; contentType: string; body: Buffer };

// Segue até 3 redirecionamentos, conferindo cada destino. Devolve a resposta final (qualquer status): quem chama decide o que fazer com 404.
export async function fetchPublic(start: URL, o: { accept: string; signal: AbortSignal; transport?: Transport }): Promise<Fetched> {
  const transport = o.transport ?? httpsTransport;
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const allowed = fetchableUrl(url);
    if (!allowed.ok) throw new ReadFailure('blocked', allowed.error);
    let res: RawResponse;
    try {
      res = await transport(url, { accept: o.accept, signal: o.signal });
    } catch (e) {
      throw classify(e);
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      try {
        url = new URL(res.location, url);
      } catch {
        throw new ReadFailure('network', 'redirecionamento inválido');
      }
      continue;
    }
    return { url, status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new ReadFailure('redirects', 'redirecionamentos demais');
}
