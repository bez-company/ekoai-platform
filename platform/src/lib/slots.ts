// Slots editoriais: dada a grade recorrente (publish_slots) e o que já está
// agendado (scheduled_posts), calcula o próximo horário livre de um canal.
// Os slots são definidos em horário local (PUBLISH_TZ_OFFSET, default BRT -3);
// tudo é resolvido pra UTC, que é como o scheduled_for é gravado.

import type { TenantDb } from './tenant-db';
import { UserError } from './errors';
import type { Channel, PublishSlot } from './types';

const HORIZON_DAYS = 90;

export function tzOffsetHours(): number {
  const v = Number(process.env.PUBLISH_TZ_OFFSET);
  return Number.isFinite(v) ? v : -3;
}

export async function getActiveSlots(t: TenantDb, channel?: Channel): Promise<PublishSlot[]> {
  let q = t.select('publish_slots').eq('active', true);
  if (channel) q = q.eq('channel', channel);
  const { data, error } = await q.order('weekday').order('hour');
  if (error) throw new Error(`Falha ao ler publish_slots: ${error.message}`);
  return (data || []) as PublishSlot[];
}

async function occupiedEpochs(t: TenantDb, channel: Channel): Promise<Set<number>> {
  const { data, error } = await t
    .select('scheduled_posts', 'scheduled_for')
    .eq('channel', channel)
    .in('status', ['scheduled', 'publishing']);
  if (error) throw new Error(`Falha ao ler scheduled_posts: ${error.message}`);
  return new Set((data || []).map((r) => new Date(r.scheduled_for as string).getTime()));
}

// Gera as próximas ocorrências (UTC, em epoch ms) de uma lista de slots a partir
// de `fromMs`, dentro do horizonte. Pura — testável sem DB.
export function upcomingSlotEpochs(slots: PublishSlot[], fromMs: number, horizonDays = HORIZON_DAYS): number[] {
  const offsetMs = tzOffsetHours() * 3600 * 1000;
  const out: number[] = [];
  for (let d = 0; d <= horizonDays; d += 1) {
    // representa o "dia local" deslocando o relógio pelo offset e lendo em UTC
    const localBase = new Date(fromMs + offsetMs + d * 86400000);
    const weekday = localBase.getUTCDay();
    const y = localBase.getUTCFullYear();
    const m = localBase.getUTCMonth();
    const day = localBase.getUTCDate();
    for (const s of slots) {
      if (s.weekday !== weekday) continue;
      const utcMs = Date.UTC(y, m, day, s.hour, s.minute) - offsetMs;
      if (utcMs <= fromMs) continue;
      out.push(utcMs);
    }
  }
  return out.sort((a, b) => a - b);
}

// Próximo slot livre do canal (ISO) ou null se a grade está vazia/saturada.
export async function nextFreeSlot(t: TenantDb, channel: Channel, fromMs = Date.now()): Promise<string | null> {
  const slots = await getActiveSlots(t, channel);
  if (!slots.length) return null;
  const occupied = await occupiedEpochs(t, channel);
  for (const epoch of upcomingSlotEpochs(slots, fromMs)) {
    if (!occupied.has(epoch)) return new Date(epoch).toISOString();
  }
  return null;
}

export async function addSlot(t: TenantDb, slot: { channel: Channel; weekday: number; hour: number; minute: number }): Promise<void> {
  const { error } = await t.insert('publish_slots', { ...slot, active: true });
  if (error) throw new Error(`Falha ao criar slot: ${error.message}`);
}

// Mudar o horário na própria Agenda (SPEC 017 decisão 13): dia, hora e minuto do mesmo slot. Os posts
// já agendados no horário antigo ficam onde estão; a fila entra no horário novo (a rota chama).
export async function updateSlot(t: TenantDb, id: string, slot: { channel: Channel; weekday: number; hour: number; minute: number }): Promise<void> {
  const { data, error } = await t.update('publish_slots', { channel: slot.channel, weekday: slot.weekday, hour: slot.hour, minute: slot.minute }).eq('id', id).select('id');
  if (error) throw new Error(`Falha ao mudar slot: ${error.message}`);
  if (!data?.length) throw new UserError('Slot não encontrado. Recarregue a página.');
}

export async function removeSlot(t: TenantDb, id: string): Promise<void> {
  const { data, error } = await t.delete('publish_slots').eq('id', id).select('id');
  if (error) throw new Error(`Falha ao remover slot: ${error.message}`);
  if (!data?.length) throw new UserError('Slot não encontrado. Recarregue a página.');
}
