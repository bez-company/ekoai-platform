// progress-model.ts: os passos da leitura da marca como eventos (SPEC 034, BEZ-532). Puro: a leitura (read.ts, understand.ts) avisa cada passo por
// um `probe`; quem escuta decide o que fazer (medir o tempo, mandar para a tela). Cada passo começa (`started`, com a frase que a tela mostra) e
// termina com resultado ou falha. Nada aqui guarda dado da pessoa: só o que a leitura já devolveria.

import type { SiteRead } from './extract';

export const STEP_KINDS = ['site', 'sitemap', 'css', 'logo', 'colors', 'identity', 'page', 'model', 'instagram'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type StepResult =
  | { kind: 'site' }
  | { kind: 'sitemap'; found: number; chosen: number }
  | { kind: 'css'; count: number }
  | { kind: 'logo'; logoUrl: string | null }
  | { kind: 'colors'; colors: string[]; fonts: SiteRead['fonts'] }
  | { kind: 'identity'; name: string | null; description: string | null }
  | { kind: 'page'; url: string; chars: number }
  | { kind: 'model' }
  | { kind: 'instagram'; state: string; count: number };

export type StepEvent =
  | { type: 'started'; kind: StepKind; label: string; url?: string }
  | ({ type: 'result' } & StepResult)
  | { type: 'failed'; kind: StepKind; message: string; url?: string };

export type Probe = (event: StepEvent) => void;

export const noProbe: Probe = () => {};

// Quem chama pode querer mais de um ouvinte (tempo e tela): o evento vai para todos, e um ouvinte que quebra não derruba a leitura.
export function fanOut(...probes: (Probe | undefined)[]): Probe {
  const list = probes.filter((p): p is Probe => typeof p === 'function');
  return (event) => {
    for (const p of list) {
      try {
        p(event);
      } catch {
        // o ouvinte é problema dele: a leitura segue
      }
    }
  };
}

const urlOf = (e: StepEvent): string | undefined => ('url' in e && typeof e.url === 'string' ? e.url : undefined);

// Só o caminho da página vai para o log: sem consulta nem fragmento, que podem carregar dado pessoal.
export function pathOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export type StepTiming = { kind: StepKind; path: string | null; ms: number; ok: boolean };
export type TimingSummary = { total_ms: number; steps: StepTiming[] };

// Mede cada passo: do `started` ao `result` ou `failed` do mesmo passo (o tipo mais o endereço, para as várias páginas). Resultado sem início
// (o passo é instantâneo) não entra.
export function stepTimer(now: () => number = Date.now) {
  const start = now();
  const open = new Map<string, number>();
  const steps: StepTiming[] = [];
  const probe: Probe = (event) => {
    const key = `${event.kind}|${urlOf(event) ?? ''}`;
    if (event.type === 'started') {
      open.set(key, now());
      return;
    }
    const at = open.get(key);
    if (at === undefined) return;
    open.delete(key);
    steps.push({ kind: event.kind, path: pathOf(urlOf(event)), ms: Math.max(0, now() - at), ok: event.type === 'result' });
  };
  return { probe, summary: (): TimingSummary => ({ total_ms: Math.max(0, now() - start), steps: [...steps] }) };
}
