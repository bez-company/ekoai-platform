// review-effort-model.ts: quanto da pessoa cada post custou para ser decidido em Aprovar (BEZ-544; EKO-04 em
// docs/analises/2026-11-03-documentacao-mestra-ai-native.md). Puro, sem I/O. Dois tempos diferentes, de propósito:
// `wait_ms` é quanto o post esperou em Aprovar (da chegada à decisão, medido no servidor) e `review_ms` é quanto a
// pessoa ficou com o post aberto antes de decidir (medido no navegador, chega no pedido). Só o segundo é esforço;
// o primeiro mostra fila. Nenhum texto do post sai daqui: só tempo, rede, campanha e se a legenda mudou.

import type { EventProps } from './design-edit-events';

// Aba esquecida aberta não é revisão: acima disso o tempo do navegador é descartado.
export const REVIEW_MS_MAX = 4 * 3_600_000;

// Fronteira: o tempo do navegador vem do cliente. Inteiro entre 0 e 4 h; o resto vira ausente, não erro.
export function parseReviewMs(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= REVIEW_MS_MAX ? raw : null;
}

// A legenda aprovada é diferente da que a Ekoai escreveu? Espaço a mais não conta como edição.
export function captionEdited(approved: string, suggested: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return norm(approved) !== norm(suggested);
}

export type ReviewEffort = { savedAt: string | null; channel: string; campaignId: string | null; captionEdited?: boolean };

export function reviewEffortProps(effort: ReviewEffort, reviewMs: number | null, now: number = Date.now()): EventProps {
  const arrived = effort.savedAt ? Date.parse(effort.savedAt) : Number.NaN;
  return {
    channel: effort.channel,
    wait_ms: Number.isFinite(arrived) ? Math.max(0, now - arrived) : null,
    review_ms: reviewMs,
    ...(effort.campaignId ? { campaign_id: effort.campaignId } : {}),
    ...(effort.captionEdited === undefined ? {} : { caption_edited: effort.captionEdited }),
  };
}
