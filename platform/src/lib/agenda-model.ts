// agenda-model.ts: a Agenda com os horários dentro dela (SPEC 017 decisão 13, BEZ-233). Puro, sem I/O.
// O período (semana ou mês) é recortado no fuso editorial; cada horário de publicação vira um espaço
// do dia: vazio (onde entra a sugestão do coordenador, BEZ-239) ou ocupado pelo post daquele horário.
// O horário vazio mostra a sugestão do coordenador (BEZ-239) daquele horário, quando houver.
// Post agendado fora de um horário (publicar agora, horário escolhido à mão) aparece como avulso. A
// fila sem horário fica ao lado, fora da grade.

import type { Channel, PublishSlot, ScheduledPost } from './types';

export const AGENDA_VIEWS = ['week', 'month'] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];

export type AgendaQuery = { view: AgendaView; date: string }; // date = dia local AAAA-MM-DD

export type AgendaPost = Pick<ScheduledPost, 'id' | 'channel' | 'status' | 'scheduled_for' | 'caption_final' | 'image_url' | 'last_error' | 'post_id'>;

// A sugestão do coordenador (content_suggestions), só o que a Agenda mostra.
export type AgendaSuggestion = { id: string; slotAt: string; goal: string; goalLabel: string; assetId: string | null; idea: string; reason: string; campaignId?: string | null };

export type AgendaCell =
  | { kind: 'slot'; at: string; time: string; channel: Channel; slotId: string; post: AgendaPost | null; suggestion: AgendaSuggestion | null }
  | { kind: 'extra'; at: string; time: string; channel: Channel; post: AgendaPost };

export type AgendaDay = { date: string; weekday: number; inRange: boolean; past: boolean; today: boolean; cells: AgendaCell[] };

export type Agenda = { view: AgendaView; from: string; to: string; prev: string; next: string; days: AgendaDay[]; queue: AgendaPost[]; slots: number };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

// Dia local (AAAA-MM-DD) para o instante UTC da meia-noite local, e o contrário.
export function localMidnight(date: string, tzHours: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - tzHours * 3600_000;
}

export function localDate(ms: number, tzHours: number): string {
  const d = new Date(ms + tzHours * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function localTime(ms: number, tzHours: number): string {
  const d = new Date(ms + tzHours * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};
const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d && y >= 2000 && y <= 2100;
}

// Da URL: ?view=week|month&date=AAAA-MM-DD. Valor estranho cai no padrão (semana de hoje).
export function parseAgendaQuery(params: URLSearchParams, nowMs: number, tzHours: number): AgendaQuery {
  const view = (AGENDA_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as AgendaView) : 'week';
  const date = params.get('date');
  return { view, date: isDate(date) ? date : localDate(nowMs, tzHours) };
}

// Semana de segunda a domingo. Mês em semanas inteiras (a grade começa na segunda antes do dia 1º).
export function agendaRange(q: AgendaQuery): { first: string; last: string; monthStart: string | null; monthEnd: string | null; prev: string; next: string } {
  const toMonday = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));
  if (q.view === 'week') {
    const first = toMonday(q.date);
    return { first, last: addDays(first, 6), monthStart: null, monthEnd: null, prev: addDays(first, -7), next: addDays(first, 7) };
  }
  const [y, m] = q.date.split('-').map(Number);
  const monthStart = `${y}-${pad(m)}-01`;
  const monthEnd = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`, -1);
  const first = toMonday(monthStart);
  const last = addDays(toMonday(monthEnd), 6);
  return { first, last, monthStart, monthEnd, prev: addDays(monthStart, -1).slice(0, 8) + '01', next: addDays(monthEnd, 1) };
}

export function buildAgenda(input: { query: AgendaQuery; slots: PublishSlot[]; posts: AgendaPost[]; nowMs: number; tzHours: number; channel?: Channel; suggestions?: AgendaSuggestion[] }): Agenda {
  const { query, tzHours } = input;
  const range = agendaRange(query);
  const slots = input.slots.filter((s) => s.active && (!input.channel || s.channel === input.channel));
  const today = localDate(input.nowMs, tzHours);
  // O coordenador só sugere para o Instagram; a chave é o instante do horário.
  const suggestionAt = new Map((input.suggestions ?? []).map((s) => [new Date(s.slotAt).getTime(), s]));
  const queue = input.posts.filter((p) => !p.scheduled_for && p.status === 'queued');
  const timed = input.posts.filter((p) => p.scheduled_for);
  const days: AgendaDay[] = [];
  for (let date = range.first; date <= range.last; date = addDays(date, 1)) {
    const start = localMidnight(date, tzHours);
    const weekday = weekdayOf(date);
    const own = timed.filter((p) => {
      const ms = new Date(p.scheduled_for!).getTime();
      return ms >= start && ms < start + DAY;
    });
    const used = new Set<string>();
    const cells: AgendaCell[] = [];
    for (const s of slots.filter((x) => x.weekday === weekday)) {
      const ms = start + (s.hour * 60 + s.minute) * 60_000;
      const post = own.find((p) => !used.has(p.id) && p.channel === s.channel && new Date(p.scheduled_for!).getTime() === ms) ?? null;
      if (post) used.add(post.id);
      const suggestion = !post && s.channel === 'instagram' && ms > input.nowMs ? (suggestionAt.get(ms) ?? null) : null;
      cells.push({ kind: 'slot', at: new Date(ms).toISOString(), time: localTime(ms, tzHours), channel: s.channel, slotId: s.id, post, suggestion });
    }
    for (const p of own) {
      if (used.has(p.id)) continue;
      const ms = new Date(p.scheduled_for!).getTime();
      cells.push({ kind: 'extra', at: new Date(ms).toISOString(), time: localTime(ms, tzHours), channel: p.channel, post: p });
    }
    cells.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const inRange = range.monthStart ? date >= range.monthStart && date <= range.monthEnd! : true;
    days.push({ date, weekday, inRange, past: date < today, today: date === today, cells });
  }
  return { view: query.view, from: range.first, to: range.last, prev: range.prev, next: range.next, days, queue, slots: slots.length };
}

// O recorte do banco: do começo do primeiro dia ao fim do último, em UTC.
export function agendaWindow(query: AgendaQuery, tzHours: number): { fromIso: string; toIso: string } {
  const range = agendaRange(query);
  return { fromIso: new Date(localMidnight(range.first, tzHours)).toISOString(), toIso: new Date(localMidnight(addDays(range.last, 1), tzHours)).toISOString() };
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const parts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
};

// O título do período: "19 a 25 de outubro", "28 de setembro a 4 de outubro", "outubro de 2026".
export function agendaTitle(a: Pick<Agenda, 'view' | 'from' | 'to' | 'days'>): string {
  if (a.view === 'month') {
    const mid = a.days.find((d) => d.inRange)?.date ?? a.from;
    const p = parts(mid);
    return `${MONTHS[p.m - 1]} de ${p.y}`;
  }
  const f = parts(a.from);
  const t = parts(a.to);
  if (f.y !== t.y) return `${f.d} de ${MONTHS[f.m - 1]} de ${f.y} a ${t.d} de ${MONTHS[t.m - 1]} de ${t.y}`;
  if (f.m !== t.m) return `${f.d} de ${MONTHS[f.m - 1]} a ${t.d} de ${MONTHS[t.m - 1]}`;
  return `${f.d} a ${t.d} de ${MONTHS[t.m - 1]}`;
}

export const dayOfMonth = (date: string) => parts(date).d;

// Quantos posts e horários o período tem, para a linha de resumo.
export function agendaCounts(a: Pick<Agenda, 'days'>): { posts: number; slots: number; free: number } {
  const cells = a.days.filter((d) => ('inRange' in d ? d.inRange : true)).flatMap((d) => d.cells);
  return {
    posts: cells.filter((c) => c.post).length,
    slots: cells.filter((c) => c.kind === 'slot').length,
    free: cells.filter((c) => c.kind === 'slot' && !c.post).length,
  };
}
