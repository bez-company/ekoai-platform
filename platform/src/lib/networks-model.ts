// networks-model.ts: as redes que Criar post oferece (SPEC 028). Puro e sem I/O: a tela desenha as opções, a rota valida a
// escolha com a mesma regra. O Instagram está sempre disponível (o post fica agendado até a conta conectar); o LinkedIn
// só com a conta conectada; o X ainda não tem redator.

import { GENERATED_CHANNELS } from './generation-model';
import { CHANNELS, type Channel } from './types';

export type NetworkLock = 'not_connected' | 'coming_soon';

export type NetworkChip = {
  channel: Channel;
  label: string;
  sub: string; // o que a rede recebe, ou o porquê de estar travada
  locked: NetworkLock | null;
};

const LABEL: Record<Channel, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };
const SUB: Record<Channel, string> = { instagram: 'Imagem ou carrossel', linkedin: 'Texto em primeira pessoa e a capa', twitter: 'Post de até 280 caracteres' };

// `connected` são as redes com conta conectada e ativa da empresa.
export function networkChips(connected: readonly Channel[]): NetworkChip[] {
  return CHANNELS.map((channel) => {
    const written = GENERATED_CHANNELS.includes(channel);
    const locked: NetworkLock | null = !written ? 'coming_soon' : channel !== 'instagram' && !connected.includes(channel) ? 'not_connected' : null;
    const sub = locked === 'coming_soon' ? 'Em breve' : locked === 'not_connected' ? 'Não conectado. Conectar' : SUB[channel];
    return { channel, label: LABEL[channel], sub, locked };
  });
}

export const DEFAULT_NETWORKS: readonly Channel[] = ['instagram'];

// Liga ou desliga uma rede. Nunca deixa a escolha vazia, e rede travada não liga.
export function toggleNetwork(selected: readonly Channel[], channel: Channel, chips: readonly NetworkChip[]): Channel[] {
  const chip = chips.find((c) => c.channel === channel);
  if (!chip || chip.locked) return [...selected];
  if (selected.includes(channel)) return selected.length > 1 ? selected.filter((c) => c !== channel) : [...selected];
  return CHANNELS.filter((c) => c === channel || selected.includes(c));
}
