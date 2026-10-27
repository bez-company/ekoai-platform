// agenda.ts: a leitura da Agenda por período (SPEC 017 decisão 13, BEZ-233). Busca os horários
// ativos, os posts com horário dentro do recorte, a fila sem horário e as sugestões do coordenador
// (BEZ-239); a montagem é de agenda-model.

import type { TenantDb } from './tenant-db';
import { getActiveSlots, tzOffsetHours } from './slots';
import { agendaWindow, buildAgenda, type Agenda, type AgendaPost, type AgendaQuery } from './agenda-model';
import { listSuggestions } from './content-coordinator';
import type { Channel } from './types';

const COLUMNS = 'id,channel,status,scheduled_for,caption_final,image_url,last_error,post_id';
const OPEN = ['scheduled', 'publishing', 'failed', 'published'];

// Publicado que a pessoa tirou da lista (ou que foi apagado no Instagram, BEZ-360) também sai da Agenda.
async function withoutRemoved(t: TenantDb, posts: AgendaPost[]): Promise<AgendaPost[]> {
  const ids = posts.filter((p) => p.status === 'published' && p.post_id).map((p) => String(p.post_id));
  if (!ids.length) return posts;
  const { data, error } = await t.select('posts', 'id').in('id', ids).not('removed_at', 'is', null);
  if (error) throw new Error(`Falha ao ler os posts tirados da lista: ${error.message}`);
  const removed = new Set((data ?? []).map((r) => String(r.id)));
  return posts.filter((p) => !(p.status === 'published' && p.post_id && removed.has(String(p.post_id))));
}

export async function getAgenda(t: TenantDb, query: AgendaQuery, options: { nowMs?: number; channel?: Channel } = {}): Promise<Agenda> {
  const tz = tzOffsetHours();
  const { fromIso, toIso } = agendaWindow(query, tz);
  const now = options.nowMs ?? Date.now();
  const [slots, timed, queued, suggestions] = await Promise.all([
    getActiveSlots(t, options.channel),
    t.select('scheduled_posts', COLUMNS).in('status', OPEN).gte('scheduled_for', fromIso).lt('scheduled_for', toIso).order('scheduled_for', { ascending: true }),
    t.select('scheduled_posts', COLUMNS).eq('status', 'queued').order('approved_at', { ascending: true }),
    options.channel && options.channel !== 'instagram' ? Promise.resolve([]) : listSuggestions(t, new Date(now)),
  ]);
  if (timed.error) throw new Error(`Falha ao ler a agenda: ${timed.error.message}`);
  if (queued.error) throw new Error(`Falha ao ler a fila: ${queued.error.message}`);
  const posts = await withoutRemoved(t, [...(timed.data ?? []), ...(queued.data ?? [])] as AgendaPost[]);
  return buildAgenda({ query, slots, posts: options.channel ? posts.filter((p) => p.channel === options.channel) : posts, nowMs: now, tzHours: tz, channel: options.channel, suggestions });
}
