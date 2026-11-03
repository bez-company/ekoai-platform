// site-read-live.ts: a leitura em tempo real com nova tentativa e reserva (SPEC 034, ADR 0031), sem React. Abre o fluxo; se a conexão cair no meio,
// avisa, lê de novo uma vez (o que já chegou fica na tela); se o fluxo não abrir ou cair de novo, usa a leitura de resposta única de sempre.
// Termina com o resultado que a pessoa confere ou com a frase de erro.

import type { ReadEvent } from '@/lib/site-read/events';
import type { Understood } from '@/lib/site-read/understand';
import { readSiteRequest } from './site-read-api';
import type { SiteResponse } from './SiteReview';
import { streamSiteRead } from './site-read-stream';

export type SiteReadOutcome = { ok: true; res: SiteResponse } | { ok: false; error: string };

export const toResponse = (u: Understood): SiteResponse => ({ read: u.read, understanding: u.understanding, notice: u.notice, instagram: u.instagram });

type Deps = {
  onEvent: (e: ReadEvent) => void;
  // A tela avisa a pessoa: a conexão oscilou (liga e desliga) e o fluxo não está disponível (cai na espera de sempre).
  onReconnecting?: (on: boolean) => void;
  onPlain?: () => void;
  signal?: AbortSignal;
  stream?: typeof streamSiteRead;
  plain?: (site: string) => Promise<SiteReadOutcome>;
};

export async function readLive(site: string, deps: Deps): Promise<SiteReadOutcome> {
  const stream = deps.stream ?? streamSiteRead;
  const box: { end: ReadEvent | null } = { end: null };
  const onEvent = (e: ReadEvent) => {
    if (e.type === 'read.done' || e.type === 'read.failed') box.end = e;
    deps.onEvent(e);
  };

  let out = await stream(site, onEvent, deps.signal);
  if (out.kind === 'dropped' && !deps.signal?.aborted) {
    deps.onReconnecting?.(true);
    out = await stream(site, onEvent, deps.signal);
    deps.onReconnecting?.(false);
  }
  if (deps.signal?.aborted) return { ok: false, error: 'A leitura foi cancelada.' };
  if (box.end?.type === 'read.done') return { ok: true, res: toResponse(box.end.result) };
  if (box.end?.type === 'read.failed') return { ok: false, error: box.end.message };
  if (out.kind === 'refused') return { ok: false, error: out.error };
  deps.onPlain?.();
  return (deps.plain ?? readSiteRequest)(site);
}
