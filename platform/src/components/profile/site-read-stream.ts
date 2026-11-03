// site-read-stream.ts: o lado da tela da leitura em tempo real (SPEC 034, ADR 0031). Abre o fluxo de eventos de /site-read/stream com `fetch`,
// entrega cada evento válido na ordem e diz como terminou. Não decide o que fazer quando cai: quem usa (useSiteRead) tenta de novo uma vez e, se
// preciso, usa a leitura de resposta única.

import { createSseReader, type ReadEvent } from '@/lib/site-read/events';

export const STREAM_URL = '/api/profile/site-read/stream';

export type StreamOutcome =
  | { kind: 'finished' } // chegou o `read.done` ou o `read.failed`
  | { kind: 'dropped' } // o fluxo abriu e acabou sem o fim: a conexão caiu
  | { kind: 'unavailable' } // não abriu como fluxo (rota ausente, erro nosso, rede que não deixa passar)
  | { kind: 'refused'; error: string }; // a rota recusou com a frase da pessoa (sessão, teto por hora, endereço)

export async function streamSiteRead(site: string, onEvent: (e: ReadEvent) => void, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<StreamOutcome> {
  let res: Response;
  try {
    res = await fetchFn(STREAM_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ site_url: site }), signal });
  } catch {
    return signal?.aborted ? { kind: 'finished' } : { kind: 'unavailable' };
  }
  if (!res.ok) {
    // Recusa que a pessoa entende (400, 401, 403, 429): a frase vem no corpo. O resto (404, 5xx) é problema nosso: a resposta única tenta.
    if ([400, 401, 403, 429].includes(res.status)) {
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (typeof data.error === 'string' && data.error) return { kind: 'refused', error: data.error };
    }
    return { kind: 'unavailable' };
  }
  if (!res.body || !/text\/event-stream/i.test(res.headers.get('content-type') ?? '')) return { kind: 'unavailable' };

  let ended = false;
  const reader = createSseReader((e) => {
    if (e.type === 'read.done' || e.type === 'read.failed') ended = true;
    onEvent(e);
  });
  const decoder = new TextDecoder();
  const body = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      reader.push(decoder.decode(value, { stream: true }));
    }
    reader.end();
  } catch {
    return signal?.aborted ? { kind: 'finished' } : { kind: 'dropped' };
  }
  return ended ? { kind: 'finished' } : { kind: 'dropped' };
}
