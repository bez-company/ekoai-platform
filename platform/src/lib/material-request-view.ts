// material-request-view.ts: como o pedido de material aparece na tela (SPEC 036; protótipo v31). Puro, sem I/O: o Início,
// a página do pedido e o detalhe da campanha montam o cartão daqui, com o prazo no fuso da conta e o post que ele destrava.

import type { Tone } from './campaign-view';
import { slotParts } from './home-model';
import type { MaterialRequest } from './material-request-model';

export type RequestPost = { idea: string; goalLabel: string; slotAt: string };

export type RequestView = {
  id: string;
  kind: MaterialRequest['kind'];
  title: string;
  reason: string;
  dueLabel: string;
  dueToday: boolean;
  post: { idea: string; goalLabel: string; when: string } | null;
  campaignName: string | null;
  status: { label: string; tone: Tone };
  open: boolean;
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Aberto', tone: 'accent' },
  photo: { label: 'Recebido', tone: 'success' },
  kept: { label: 'Confirmado', tone: 'success' },
  edited: { label: 'Corrigido', tone: 'success' },
  off: { label: 'Desligado', tone: 'neutral' },
  dismissed: { label: 'Dispensado', tone: 'neutral' },
  expired: { label: 'Venceu', tone: 'warning' },
};

const localDay = (ms: number, tz: number) => new Date(ms + tz * 3_600_000).toISOString().slice(0, 10);

export function requestView(r: MaterialRequest, o: { now: number; tz: number; post?: RequestPost | null; campaignName?: string | null }): RequestView {
  const due = Date.parse(r.dueAt);
  const p = slotParts(r.dueAt, o.tz);
  const dueToday = r.status === 'open' && localDay(due, o.tz) === localDay(o.now, o.tz);
  const dm = new Date(due + o.tz * 3_600_000).toISOString().slice(5, 10).split('-').reverse().join('/');
  const post = o.post ? { idea: o.post.idea, goalLabel: o.post.goalLabel, when: (({ weekday, day, time }) => `${weekday} ${day} às ${time}`)(slotParts(o.post.slotAt, o.tz)) } : null;
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    reason: r.reason,
    dueLabel: dueToday ? `Vence hoje às ${p.time}` : `Até ${p.weekday} ${dm} às ${p.time}`,
    dueToday,
    post,
    campaignName: o.campaignName ?? null,
    status: r.status === 'open' ? STATUS.open : STATUS[r.outcome ?? r.status] ?? STATUS.expired,
    open: r.status === 'open' && due > o.now,
  };
}
