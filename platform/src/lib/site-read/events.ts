// events.ts: o contrato dos eventos da leitura da marca em tempo real (SPEC 034, ADR 0031). Puro. O servidor transforma cada passo da leitura
// (progress-model.ts) num evento numerado e o manda como `text/event-stream`; a tela lê o fluxo, confere cada evento aqui (dado de fora, nunca
// confiado) e descarta o que não tem a forma certa. `seq` cresce de 1 em 1 e `t` são os milissegundos desde o começo da leitura.

import { STEP_KINDS, type StepEvent, type StepKind, type StepResult, type TimingSummary } from './progress-model';
import type { Understood } from './understand';

export type ReadEvent =
  | { type: 'read.started'; seq: number; t: number; site: string }
  | { type: 'step.started'; seq: number; t: number; kind: StepKind; label: string; url?: string }
  | ({ type: 'step.result'; seq: number; t: number } & StepResult)
  | { type: 'step.failed'; seq: number; t: number; kind: StepKind; message: string; url?: string }
  | { type: 'read.done'; seq: number; t: number; result: Understood; timing: TimingSummary }
  | { type: 'read.failed'; seq: number; t: number; message: string };

export type ReadEventType = ReadEvent['type'];

// Dá número e tempo aos eventos, na ordem em que a leitura os produz.
export function eventSequencer(now: () => number = Date.now) {
  const start = now();
  let seq = 0;
  const base = () => ({ seq: (seq += 1), t: Math.max(0, now() - start) });
  return {
    started: (site: string): ReadEvent => ({ type: 'read.started', ...base(), site }),
    step: (e: StepEvent): ReadEvent => {
      if (e.type === 'started') return { type: 'step.started', ...base(), kind: e.kind, label: e.label, ...(e.url ? { url: e.url } : {}) };
      if (e.type === 'failed') return { type: 'step.failed', ...base(), kind: e.kind, message: e.message, ...(e.url ? { url: e.url } : {}) };
      return { ...e, type: 'step.result', ...base() } as ReadEvent;
    },
    done: (result: Understood, timing: TimingSummary): ReadEvent => ({ type: 'read.done', ...base(), result, timing }),
    failed: (message: string): ReadEvent => ({ type: 'read.failed', ...base(), message }),
  };
}

// ── no fio: Server-Sent Events ──
// Um quadro por evento (`id`, `event`, `data` numa linha só). Linha que começa com `:` é comentário: serve de sinal de vida para o fluxo não ser cortado.
export const HEARTBEAT = ': ping\n\n';
export const encodeEvent = (e: ReadEvent): string => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

// ── conferência de um evento que chegou ──
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 600): v is string => typeof v === 'string' && v.length <= max;
const strOrNull = (v: unknown): v is string | null => v === null || str(v);
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const kindOf = (v: unknown): v is StepKind => typeof v === 'string' && (STEP_KINDS as readonly string[]).includes(v);

function parseResult(o: Record<string, unknown>): StepResult | null {
  switch (o.kind) {
    case 'site':
    case 'model':
      return { kind: o.kind };
    case 'sitemap':
      return int(o.found) && int(o.chosen) ? { kind: 'sitemap', found: o.found, chosen: o.chosen } : null;
    case 'css':
      return int(o.count) ? { kind: 'css', count: o.count } : null;
    case 'logo':
      return strOrNull(o.logoUrl) ? { kind: 'logo', logoUrl: o.logoUrl } : null;
    case 'colors': {
      const fonts = isObj(o.fonts) ? o.fonts : null;
      if (!Array.isArray(o.colors) || !o.colors.every((c) => str(c, 9)) || !fonts || !strOrNull(fonts.heading) || !strOrNull(fonts.body)) return null;
      return { kind: 'colors', colors: o.colors as string[], fonts: { heading: fonts.heading, body: fonts.body } };
    }
    case 'identity':
      return strOrNull(o.name) && strOrNull(o.description) ? { kind: 'identity', name: o.name, description: o.description } : null;
    case 'page':
      return str(o.url, 2000) && int(o.chars) ? { kind: 'page', url: o.url, chars: o.chars } : null;
    case 'instagram':
      return str(o.state, 40) && int(o.count) ? { kind: 'instagram', state: o.state, count: o.count } : null;
    default:
      return null;
  }
}

// `null` quando o evento não tem a forma do contrato: quem lê ignora e segue.
export function parseReadEvent(json: unknown): ReadEvent | null {
  if (!isObj(json) || !int(json.seq) || !int(json.t) || typeof json.type !== 'string') return null;
  const base = { seq: json.seq, t: json.t };
  const url = typeof json.url === 'string' && json.url.length <= 2000 ? { url: json.url } : {};
  switch (json.type) {
    case 'read.started':
      return str(json.site, 2000) ? { type: 'read.started', ...base, site: json.site } : null;
    case 'step.started':
      return kindOf(json.kind) && str(json.label) ? { type: 'step.started', ...base, kind: json.kind, label: json.label, ...url } : null;
    case 'step.failed':
      return kindOf(json.kind) && str(json.message) ? { type: 'step.failed', ...base, kind: json.kind, message: json.message, ...url } : null;
    case 'step.result': {
      const r = parseResult(json);
      return r ? ({ type: 'step.result', ...base, ...r } as ReadEvent) : null;
    }
    case 'read.done': {
      const result = isObj(json.result) && isObj(json.result.read) ? (json.result as unknown as Understood) : null;
      const timing = isObj(json.timing) && int(json.timing.total_ms) && Array.isArray(json.timing.steps) ? (json.timing as unknown as TimingSummary) : null;
      return result && timing ? { type: 'read.done', ...base, result, timing } : null;
    }
    case 'read.failed':
      return str(json.message) ? { type: 'read.failed', ...base, message: json.message } : null;
    default:
      return null;
  }
}

// ── leitor do fluxo (lado da tela) ──
// Recebe pedaços de texto do jeito que chegam (um evento pode vir partido ao meio) e entrega cada evento válido, na ordem. Comentário
// (`:`), quadro sem `data`, JSON quebrado, evento fora do contrato e `seq` repetido ou voltando são descartados.
export function createSseReader(onEvent: (e: ReadEvent) => void) {
  let buffer = '';
  let last = 0;
  const frame = (raw: string) => {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const e = parseReadEvent(json);
    if (!e || e.seq <= last) return;
    last = e.seq;
    onEvent(e);
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, '\n');
      let i = buffer.indexOf('\n\n');
      while (i !== -1) {
        frame(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
        i = buffer.indexOf('\n\n');
      }
    },
    // O fluxo acabou: o último quadro sem a linha em branco ainda vale.
    end() {
      if (buffer.trim()) frame(buffer);
      buffer = '';
    },
  };
}
