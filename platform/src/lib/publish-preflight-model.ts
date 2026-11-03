// publish-preflight-model.ts: a conferência logo antes de publicar (BEZ-275; EKO-02 em
// docs/analises/2026-11-03-documentacao-mestra-ai-native.md). Puro, sem I/O: recebe o texto do post como foi aprovado e o
// estado de HOJE dos fatos, da campanha e da foto, e diz o que impede o envio. Aprovar não congela a verdade: fato que
// venceu ou foi recusado, frase que entrou em "nunca afirmar", campanha pausada ou encerrada e foto que perdeu a
// autorização depois da aprovação seguram o post. Ele fica como "Não publicado" com o motivo, até a pessoa corrigir.

import { factsForPrompt, type CompanyFact } from './company-facts-model';
import type { Campaign } from './campaign-model';
import { canUseInPost, type MediaAsset } from './media-asset-model';
import { staleFactIssues } from './design/review';
import type { ScheduledPost } from './types';

export type PreflightRule = 'fact_not_valid' | 'never_claim' | 'campaign_paused' | 'campaign_ended' | 'photo_removed' | 'photo_no_consent';
export type PreflightBlock = { rule: PreflightRule; message: string };

export type PreflightInput = {
  texts: string[];
  facts: readonly CompanyFact[];
  // A campanha do post como está hoje; null = o post não é de campanha.
  campaign: Pick<Campaign, 'name' | 'status' | 'endDate' | 'offering'> | null;
  // linked = o post usa uma foto do banco de imagens; asset null = a foto saiu do banco.
  photo: { linked: boolean; asset: Pick<MediaAsset, 'hasPeople' | 'peopleConsent'> | null };
  today: string; // AAAA-MM-DD, dia local
};

const NEXT_STEP = 'Depois de corrigir, publique agora ou reagende na Agenda.';

const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

// O texto que vai ao ar: legenda, texto da arte (gancho, corpo, pergunta, lâminas) e texto alternativo.
export function postTexts(s: Pick<ScheduledPost, 'caption_final' | 'variation' | 'generation'>): string[] {
  const v = s.variation ?? ({} as ScheduledPost['variation']);
  const slides = (Array.isArray(v?.slides) ? v.slides : []).flatMap((slide) =>
    typeof slide === 'string' ? [slide] : slide && typeof slide === 'object' ? Object.values(slide).filter((x): x is string => typeof x === 'string') : [],
  );
  const alts = Array.isArray(s.generation?.slide_alts) ? s.generation.slide_alts : [];
  return [s.caption_final, v?.hook, v?.body, v?.question, ...slides, s.generation?.alt_text, ...alts].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

export function preflightBlocks(input: PreflightInput): PreflightBlock[] {
  const blocks: PreflightBlock[] = [];
  const { campaign, photo, today } = input;

  if (campaign?.status === 'paused') {
    blocks.push({ rule: 'campaign_paused', message: `A campanha "${campaign.name}" está pausada, então o post dela não saiu. Retome a campanha.` });
  } else if (campaign && (campaign.status === 'ended' || campaign.status === 'archived' || (campaign.endDate !== null && campaign.endDate < today))) {
    const when = campaign.endDate && campaign.endDate < today ? ` em ${dm(campaign.endDate)}` : '';
    blocks.push({ rule: 'campaign_ended', message: `A campanha "${campaign.name}" terminou${when}, então o post dela não saiu para não anunciar o que já acabou. Revise o texto.` });
  }

  const facts = factsForPrompt(input.facts, today);
  const allowed = campaign?.offering && blocks.length === 0 ? [campaign.offering] : [];
  for (const issue of staleFactIssues({ texts: input.texts, facts: facts.facts, allowed, inactive: facts.inactive })) {
    blocks.push({ rule: 'fact_not_valid', message: `${issue.message}` });
  }
  const all = input.texts.join(' \n ').toLowerCase();
  for (const claim of facts.never) {
    const c = claim.trim().toLowerCase();
    if (c && all.includes(c)) blocks.push({ rule: 'never_claim', message: `O post diz "${claim.trim()}", que está na lista do que a empresa nunca afirma. Tire a frase.` });
  }

  if (photo.linked && !photo.asset) {
    blocks.push({ rule: 'photo_removed', message: 'A foto deste post foi apagada do banco de imagens, então ele não saiu. Para publicar, crie o post de novo com outra foto.' });
  } else if (photo.asset && !canUseInPost(photo.asset)) {
    blocks.push({ rule: 'photo_no_consent', message: `A foto mostra pessoas e está sem a autorização de uso de imagem, então o post não saiu. Marque a autorização no banco de imagens.` });
  }
  return blocks;
}

// O texto da notificação e do erro do post: todos os motivos e, uma vez, o próximo passo.
export function preflightMessage(blocks: readonly PreflightBlock[]): string {
  if (blocks.length === 0) return '';
  const step = blocks.some((b) => b.rule !== 'photo_removed') ? ` ${NEXT_STEP}` : '';
  return `${blocks.map((b) => b.message).join(' ')}${step}`;
}
