// agenda.ts: a leitura da Agenda por período (SPEC 017 decisão 13, BEZ-233). Busca os horários
// ativos, os posts com horário dentro do recorte e a fila sem horário; a montagem é de agenda-model.

import type { TenantDb } from './tenant-db';
import { getActiveSlots, tzOffsetHours } from './slots';
import { agendaWindow, buildAgenda, type Agenda, type AgendaPost, type AgendaQuery } from './agenda-model';
import type { Channel } from './types';

const COLUMNS = 'id,channel,status,scheduled_for,caption_final,image_url,last_error';
const OPEN = ['scheduled', 'publishing', 'failed', 'published'];

export async function getAgenda(t: TenantDb, query: AgendaQuery, options: { nowMs?: number; channel?: Channel } = {}): Promise<Agenda> {
  const tz = tzOffsetHours();
  const { fromIso, toIso } = agendaWindow(query, tz);
  const [slots, timed, queued] = await Promise.all([
    getActiveSlots(t, options.channel),
    t.select('scheduled_posts', COLUMNS).in('status', OPEN).gte('scheduled_for', fromIso).lt('scheduled_for', toIso).order('scheduled_for', { ascending: true }),
    t.select('scheduled_posts', COLUMNS).eq('status', 'queued').order('approved_at', { ascending: true }),
  ]);
  if (timed.error) throw new Error(`Falha ao ler a agenda: ${timed.error.message}`);
  if (queued.error) throw new Error(`Falha ao ler a fila: ${queued.error.message}`);
  const posts = [...(timed.data ?? []), ...(queued.data ?? [])] as AgendaPost[];
  return buildAgenda({ query, slots, posts: options.channel ? posts.filter((p) => p.channel === options.channel) : posts, nowMs: options.nowMs ?? Date.now(), tzHours: tz, channel: options.channel });
}
