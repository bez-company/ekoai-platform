// campaign-view.ts: como as telas de campanha mostram o que a campanha tem (SPEC 018). Puro, sem I/O. O texto
// fala de posts, cadência e engajamento; nunca de venda, conversão ou retorno.

import { KIND_LABEL, type Campaign, type CampaignProgress, type CampaignStatus, type EngagementCompare } from './campaign-model';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export const STATUS_BADGE: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  active: { label: 'Ativa', tone: 'success' },
  paused: { label: 'Pausada', tone: 'warning' },
  ended: { label: 'Encerrada', tone: 'neutral' },
  archived: { label: 'Arquivada', tone: 'neutral' },
};

// "2026-10-12" para "12/10".
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export function periodLabel(c: Pick<Campaign, 'startDate' | 'endDate'>): string {
  if (c.startDate && c.endDate) return `${dm(c.startDate)} a ${dm(c.endDate)}`;
  if (c.endDate) return `até ${dm(c.endDate)}`;
  if (c.startDate) return `desde ${dm(c.startDate)}`;
  return 'Sem prazo';
}

export function kindLabel(c: Pick<Campaign, 'kind'>): string {
  return c.kind ? KIND_LABEL[c.kind] : 'Campanha';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function daysLeftLabel(daysLeft: number | null): string {
  if (daysLeft === null) return 'Sem prazo';
  if (daysLeft === 0) return 'Termina hoje';
  return daysLeft === 1 ? 'Falta 1 dia' : `Faltam ${daysLeft} dias`;
}

// Quanto do prazo já passou, de 0 a 100, para a barra de tempo.
export function elapsedPercent(p: Pick<CampaignProgress, 'daysLeft' | 'daysTotal'>): number {
  if (p.daysLeft === null || !p.daysTotal || p.daysTotal <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((p.daysTotal - p.daysLeft) / p.daysTotal) * 100)));
}

export function cadenceLabel(p: Pick<CampaignProgress, 'cadence'>): string {
  const { thisWeek, target } = p.cadence;
  return target ? `${thisWeek} de ${target} posts` : plural(thisWeek, 'post', 'posts');
}

const rate = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const perPost = (v: number) => `${Math.round(v)} por post`;

// O engajamento da campanha ao lado da média da conta, na mesma medida. Sem amostra, nada: a tela não inventa.
export function engagementView(e: EngagementCompare): { campaign: string; account: string | null; diff: string | null; posts: number } | null {
  if (e.campaign === null) return null;
  const fmt = e.unit === 'rate' ? rate : perPost;
  let diff: string | null = null;
  if (e.account !== null) {
    if (e.unit === 'rate') {
      const points = (e.campaign - e.account) * 100;
      diff = `${points >= 0 ? '+' : '-'}${Math.abs(points).toFixed(1).replace('.', ',')} ponto${Math.abs(points) > 1 ? 's' : ''}`;
    } else {
      const n = Math.round(e.campaign - e.account);
      diff = `${n >= 0 ? '+' : '-'}${Math.abs(n)} por post`;
    }
  }
  return { campaign: fmt(e.campaign), account: e.account === null ? null : fmt(e.account), diff, posts: e.campaignPosts };
}

export const ENGAGEMENT_NOTE = 'Engajamento é curtida, comentário e salvamento nos posts da campanha. Não mede venda nem pedido.';

// A frase que acompanha o motivo da sugestão de campanha no Início e na Agenda: o nome curto da campanha.
export function shortCampaignName(name: string): string {
  return name.length > 30 ? `${name.slice(0, 27).trimEnd()}...` : name;
}
