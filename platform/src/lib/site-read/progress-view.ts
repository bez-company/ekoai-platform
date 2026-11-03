// progress-view.ts: o que a tela de "lendo a marca" mostra a cada momento (SPEC 034, BEZ-533). Puro: recebe os eventos da leitura (events.ts) um a
// um e devolve o estado da tela, sem estado escondido. Cada cartão de resultado nasce de um evento do servidor; nada aqui finge progresso.
// O resultado que a pessoa confere (SiteResponse) só chega no `read.done`; antes disso são só prévias.

import type { ReadEvent } from './events';
import { pathOf } from './progress-model';
import type { Understood } from './understand';

export type CardStatus = 'wait' | 'load' | 'done' | 'warn';
export type LogTone = 'info' | 'warn' | 'bad';
export type LogLine = { seq: number; t: number; text: string; tone: LogTone };

export type ReadView = {
  phase: 'idle' | 'reading' | 'done' | 'failed';
  site: string;
  elapsedMs: number;
  now: { label: string; path: string | null } | null;
  pages: { read: number; chosen: number };
  // Páginas que não abriram: a leitura segue sem elas e a tela avisa quantas.
  skipped: number;
  log: LogLine[];
  logo: { status: CardStatus; logoUrl: string | null; note: string | null };
  colors: { status: CardStatus; colors: string[]; fonts: { heading: string | null; body: string | null }; note: string | null };
  identity: { status: CardStatus; name: string | null; description: string | null; note: string | null };
  voice: { status: CardStatus; note: string | null };
  facts: { status: CardStatus; count: number; note: string | null };
  instagram: { status: CardStatus; count: number; note: string | null } | null;
  failure: string | null;
  result: Understood | null;
  doneMs: number | null;
};

export const LOG_MAX = 8;

export function initialView(site = ''): ReadView {
  return {
    phase: 'idle',
    site,
    elapsedMs: 0,
    now: null,
    pages: { read: 0, chosen: 0 },
    skipped: 0,
    log: [],
    logo: { status: 'wait', logoUrl: null, note: null },
    colors: { status: 'wait', colors: [], fonts: { heading: null, body: null }, note: null },
    identity: { status: 'wait', name: null, description: null, note: null },
    voice: { status: 'wait', note: null },
    facts: { status: 'wait', count: 0, note: null },
    instagram: null,
    failure: null,
    result: null,
    doneMs: null,
  };
}

const push = (view: ReadView, line: LogLine): ReadView => ({ ...view, log: [line, ...view.log].slice(0, LOG_MAX) });

const NO_LOGO = 'Não achamos o logo no site. Você envia o arquivo depois, em Configurações.';
const NO_COLORS = 'Não achamos cores definidas no site. Você escolhe as cores no próximo passo.';
const NO_IDENTITY = 'O site não diz o nome nem a descrição da empresa.';

// Quando a leitura recomeça depois de a conexão cair, o que já chegou fica na tela (e é substituído pelo resultado novo).
export function applyEvent(view: ReadView, e: ReadEvent): ReadView {
  const v: ReadView = { ...view, elapsedMs: Math.max(view.elapsedMs, e.t) };
  switch (e.type) {
    // O histórico começa no `step.started` do site ("Abrindo ..."): o `read.started` só abre a tela, sem linha própria (saía duas vezes).
    case 'read.started':
      return { ...v, phase: 'reading', site: e.site, failure: null, result: null, doneMs: null, pages: { read: 0, chosen: 0 }, skipped: 0 };

    case 'step.started': {
      const path = pathOf(e.url);
      const next = { ...v, now: { label: e.label, path } };
      if (e.kind === 'model') return push({ ...next, voice: { status: 'load', note: null }, facts: { status: 'load', count: 0, note: null } }, { seq: e.seq, t: e.t, text: e.label, tone: 'info' });
      if (e.kind === 'instagram') return push({ ...next, instagram: { status: 'load', count: 0, note: null } }, { seq: e.seq, t: e.t, text: e.label, tone: 'info' });
      if (e.kind === 'logo') return push({ ...next, logo: { ...v.logo, status: v.logo.status === 'done' ? 'done' : 'load' } }, { seq: e.seq, t: e.t, text: e.label, tone: 'info' });
      if (e.kind === 'colors') return push({ ...next, colors: { ...v.colors, status: v.colors.status === 'done' ? 'done' : 'load' } }, { seq: e.seq, t: e.t, text: e.label, tone: 'info' });
      return push(next, { seq: e.seq, t: e.t, text: path ? `${e.label} · ${path}` : e.label, tone: 'info' });
    }

    case 'step.result':
      switch (e.kind) {
        case 'sitemap': {
          const text = e.chosen === 0 ? 'Só a página inicial tinha texto para ler.' : e.found > 0 ? `Achei ${e.found} páginas no site. Vou ler ${e.chosen}.` : `Não achei o mapa do site. Leio ${e.chosen} ${e.chosen === 1 ? 'página' : 'páginas'} do menu.`;
          return push({ ...v, pages: { read: v.pages.read, chosen: e.chosen } }, { seq: e.seq, t: e.t, text, tone: 'info' });
        }
        case 'page':
          return { ...v, pages: { read: v.pages.read + 1, chosen: v.pages.chosen } };
        case 'logo':
          return { ...v, logo: e.logoUrl ? { status: 'done', logoUrl: e.logoUrl, note: null } : { status: 'warn', logoUrl: null, note: NO_LOGO } };
        case 'colors': {
          const any = e.colors.length > 0 || !!e.fonts.heading || !!e.fonts.body;
          return { ...v, colors: { status: any ? 'done' : 'warn', colors: e.colors, fonts: e.fonts, note: any ? null : NO_COLORS } };
        }
        case 'identity': {
          const any = !!e.name || !!e.description;
          return { ...v, identity: { status: any ? 'done' : 'warn', name: e.name, description: e.description, note: any ? null : NO_IDENTITY } };
        }
        case 'instagram':
          return push({ ...v, instagram: { status: 'done', count: e.count, note: null } }, { seq: e.seq, t: e.t, text: `Li ${e.count} ${e.count === 1 ? 'legenda' : 'legendas'} do Instagram`, tone: 'info' });
        default:
          return v;
      }

    case 'step.failed': {
      const tone: LogTone = e.kind === 'page' ? 'warn' : 'bad';
      const path = pathOf(e.url);
      const line = { seq: e.seq, t: e.t, text: path && e.kind === 'page' ? `${path}: ${e.message}` : e.message, tone };
      if (e.kind === 'page') return push({ ...v, pages: { read: v.pages.read + 1, chosen: v.pages.chosen }, skipped: v.skipped + 1 }, line);
      if (e.kind === 'model') return push({ ...v, voice: { status: 'warn', note: e.message }, facts: { status: 'warn', count: 0, note: e.message } }, line);
      if (e.kind === 'instagram') return push({ ...v, instagram: { status: 'warn', count: 0, note: e.message } }, line);
      return push(v, line);
    }

    case 'read.done': {
      const u = e.result.understanding;
      const factCount = u?.facts.length ?? 0;
      const note = e.result.notice;
      const ig = e.result.instagram;
      return {
        ...v,
        phase: 'done',
        now: null,
        result: e.result,
        doneMs: e.t,
        failure: null,
        voice: u ? { status: 'done', note: null } : { status: 'warn', note },
        facts: factCount ? { status: 'done', count: factCount, note: null } : { status: 'warn', count: 0, note },
        instagram: v.instagram ?? (ig && ig.state !== 'not_connected' ? { status: ig.state === 'ok' ? 'done' : 'warn', count: ig.count, note: null } : null),
      };
    }

    case 'read.failed':
      return push({ ...v, phase: 'failed', now: null, failure: e.message }, { seq: e.seq, t: e.t, text: e.message, tone: 'bad' });
  }
}

// Frase do tempo: "47 s" ou "1 min 5 s".
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
// Tempo de uma linha do histórico: "0,4s", "9,8s", "23s".
export function formatStamp(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? `${s.toFixed(1).replace('.', ',')}s` : `${Math.round(s)}s`;
}
