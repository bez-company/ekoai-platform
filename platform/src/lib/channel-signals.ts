// channel-signals.ts: o que cada rede diz medir e o que o post precisa fazer (channel-signals.json, SPEC 028).
// Os construtores de prompt leem daqui, então uma mudança de algoritmo muda um arquivo e uma data, não um prompt
// espalhado. Puro e sem I/O.

import data from './channel-signals.json';

export type SignalConfidence = 'high' | 'medium' | 'low';

export type ChannelSignals = {
  label: string;
  reviewed_at: string;
  confidence: SignalConfidence;
  measures: string[];
  content_must: string[];
  avoid: string[];
  sources: { title: string; url: string | null; kind: 'primary' | 'secondary' }[];
};

export const MAX_AGE_DAYS = data.max_age_days as number;
export const CHANNEL_SIGNALS = data.channels as Record<string, ChannelSignals>;

const DAY = 86_400_000;

// Dias desde a última revisão da rede; NaN quando a data não é válida.
export function signalAgeDays(channel: string, now: number = Date.now()): number {
  const at = Date.parse(CHANNEL_SIGNALS[channel]?.reviewed_at ?? '');
  return Number.isFinite(at) ? Math.floor((now - at) / DAY) : Number.NaN;
}

// Redes cuja revisão passou do prazo (ou não tem data válida). O teste de CI reprova a lista não vazia.
export function staleChannels(now: number = Date.now()): string[] {
  return Object.keys(CHANNEL_SIGNALS).filter((c) => !(signalAgeDays(c, now) <= MAX_AGE_DAYS));
}

// As linhas do prompt: o que a rede mede e o que o post faz. Rede desconhecida não devolve linha nenhuma.
export function signalPromptLines(channel: string): string[] {
  const s = CHANNEL_SIGNALS[channel];
  if (!s) return [];
  return [
    `## O que o ${s.label} pesa na hora de mostrar o post`,
    ...s.measures.map((m) => `- ${m}`),
    `O post serve a isso quando: ${s.content_must.join('; ')}.`,
    `Evite: ${s.avoid.join('; ')}.`,
  ];
}
