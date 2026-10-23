// capabilities.ts: o que cada rede aceita por formato (channel-capabilities.json). O
// scheduler não chama a API para formato que não é `auto`, e /configuracoes mostra a matriz.

import matrix from './channel-capabilities.json';

export type PublishMode = 'auto' | 'planned' | 'manual';

export type FormatCapability = { publish: PublishMode; label: string; note?: string };

export type ChannelCapability = {
  label: string;
  metrics: { source: 'api' | 'csv' | 'none'; note: string };
  formats: Record<string, FormatCapability>;
};

export const CAPABILITIES = matrix.channels as Record<string, ChannelCapability>;

// Formato ausente na variação = post simples daquela rede.
export function formatCapability(channel: string, format?: string | null): FormatCapability | null {
  const formats = CAPABILITIES[channel]?.formats;
  if (!formats) return null;
  return formats[format || 'single'] ?? null;
}

export function canAutoPublish(channel: string, format?: string | null): boolean {
  return formatCapability(channel, format)?.publish === 'auto';
}

// Motivo curto pra quem aprova ou pro erro do scheduler.
export function notPublishableReason(channel: string, format?: string | null): string {
  const cap = formatCapability(channel, format);
  const name = format || 'single';
  if (!cap) return `O formato "${name}" não existe para ${channel}.`;
  if (cap.publish === 'manual') return `${cap.label} não sai pela API do ${channel}. ${cap.note ?? ''}`.trim();
  return `${cap.label} ainda não é publicado pela plataforma. ${cap.note ?? ''}`.trim();
}
