// facts-view.ts: como a tela de fatos mostra cada fato (SPEC 018). Puro, sem I/O: o estado do fato
// (company-facts-model.ts) vira etiqueta, linha de validade e contagens. Texto em português, sem travessão.

import { CATEGORY_LABEL, factStanding, todayLocal, type CompanyFact, type FactStanding } from './company-facts-model';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

// "2026-10-29" para "29/10".
export function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function dueIn(daysLeft: number): string {
  if (daysLeft <= 0) return 'Vence hoje';
  return daysLeft === 1 ? 'Vence amanhã' : `Vence em ${daysLeft} dias`;
}

export function factBadge(standing: FactStanding, daysLeft: number | null): { label: string; tone: Tone } {
  switch (standing) {
    case 'valid':
      return { label: 'Confirmado', tone: 'success' };
    case 'soon':
      return { label: dueIn(daysLeft ?? 0), tone: 'warning' };
    case 'pending':
      return { label: 'Para revisar', tone: 'warning' };
    case 'expired':
      return { label: 'Vencido', tone: 'danger' };
    case 'rejected':
      return { label: 'Recusado', tone: 'neutral' };
    default:
      return { label: 'Desligado', tone: 'neutral' };
  }
}

// A linha de baixo do fato: de onde veio, quando foi confirmado e até quando vale.
export function factDetail(fact: CompanyFact, standing: FactStanding, sourceLabel: string): string {
  const parts = [fact.sourceNote ? `${sourceLabel} · ${fact.sourceNote}` : sourceLabel];
  if (fact.kind === 'fact') {
    if (standing === 'pending') parts.push(fact.proposedBy === 'agent' ? 'Proposto pela Ekoai' : 'Esperando confirmação');
    else if (standing === 'rejected') parts.push('Recusado');
    else if (fact.verifiedAt) parts.push(`Confirmado em ${dayLabel(todayLocal(new Date(fact.verifiedAt)))}`);
    if (standing === 'expired' && fact.validUntil) parts.push(`Venceu em ${dayLabel(fact.validUntil)}`);
    else if (standing === 'valid' || standing === 'soon') parts.push(fact.validUntil ? `Vale até ${dayLabel(fact.validUntil)}` : 'Sem prazo');
  }
  if (!fact.active) parts.push('Desligado');
  return parts.join(' · ');
}

export function factCategory(fact: CompanyFact): string {
  return CATEGORY_LABEL[fact.category];
}

export type FactCounts = { all: number; pending: number; soon: number; expired: number };

// Contagens dos fatos (kind = fact): as abas e os avisos do alto da tela.
export function factCounts(facts: readonly CompanyFact[], today: string = todayLocal()): FactCounts {
  const out: FactCounts = { all: 0, pending: 0, soon: 0, expired: 0 };
  for (const f of facts) {
    if (f.kind !== 'fact') continue;
    out.all += 1;
    const { state } = factStanding(f, today);
    if (state === 'pending') out.pending += 1;
    else if (state === 'soon') out.soon += 1;
    else if (state === 'expired') out.expired += 1;
  }
  return out;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// O aviso do alto da tela, ou nada quando tudo está em dia.
export function expiryBanner(counts: Pick<FactCounts, 'soon' | 'expired'>): string | null {
  const { soon, expired } = counts;
  if (!soon && !expired) return null;
  const parts: string[] = [];
  if (expired) parts.push(`${expired} ${plural(expired, 'fato venceu', 'fatos venceram')}`);
  if (soon) parts.push(`${soon} ${plural(soon, 'fato vence', 'fatos vencem')} em até 7 dias`);
  const tail = expired ? ' Fato vencido não entra nos posts. Atualize a validade para voltar a usar.' : ' Atualize a validade para os posts continuarem usando.';
  return `${parts.join(' e ')}.${tail}`;
}
