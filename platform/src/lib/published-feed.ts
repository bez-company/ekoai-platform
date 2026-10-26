// published-feed.ts: os posts publicados como a tela Publicados mostra (SPEC 017, decisão 14,
// BEZ-238). O post durável (posts) diz quando e onde saiu; a imagem e a legenda final vêm do
// agendamento que o publicou (scheduled_posts); as métricas, da última coleta (BEZ-183).

import type { TenantDb } from './tenant-db';
import { latestPostMetrics, type PostMetricsView } from './instagram-metrics';
import type { Channel } from './types';

export type PublishedItem = {
  id: string;
  channel: Channel;
  title: string;
  caption: string;
  imageUrl: string | null;
  slides: number; // lâminas do carrossel; 0 quando é uma imagem só
  publishedAt: string | null;
  metrics: PostMetricsView | null;
  funnel: { cadastros: number; ativados: number; pagantes: number } | null;
};

type PostRow = { id: string; channel: Channel; hook: string | null; body: string | null; published_at: string | Date | null; scheduled_post_id: string | null; funnel?: PublishedItem['funnel'] };
type ScheduledRow = { id: string; image_url: string | null; caption_final: string | null; slide_urls: unknown };

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

// Título curto do post: o gancho; sem gancho, a primeira linha da legenda.
export function titleOf(hook: string | null, caption: string): string {
  const h = hook?.trim();
  if (h) return h;
  const first = caption.trim().split('\n')[0] ?? '';
  return first.length > 80 ? `${first.slice(0, 79)}…` : first || 'Post sem título';
}

// Média do engajamento dos posts que já têm leitura; null quando nenhum tem.
export function averageEngagement(items: Pick<PublishedItem, 'metrics'>[]): number | null {
  const rates = items.map((i) => i.metrics?.engagement).filter((r): r is number => typeof r === 'number');
  if (!rates.length) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

async function assemble(t: TenantDb, posts: PostRow[]): Promise<PublishedItem[]> {
  const scheduledIds = posts.map((p) => p.scheduled_post_id).filter((id): id is string => !!id);
  const scheduled = new Map<string, ScheduledRow>();
  if (scheduledIds.length) {
    const { data, error } = await t.select('scheduled_posts', 'id,image_url,caption_final,slide_urls').in('id', scheduledIds);
    if (error) throw new Error(`Falha ao ler as imagens dos publicados: ${error.message}`);
    for (const r of (data ?? []) as unknown as ScheduledRow[]) scheduled.set(String(r.id), r);
  }
  const metrics = await latestPostMetrics(t, posts.map((p) => p.id));
  return posts.map((p) => {
    const s = p.scheduled_post_id ? scheduled.get(p.scheduled_post_id) : undefined;
    const caption = s?.caption_final ?? [p.hook, p.body].filter(Boolean).join('\n\n');
    return {
      id: String(p.id),
      channel: p.channel,
      title: titleOf(p.hook, caption),
      caption,
      imageUrl: s?.image_url ?? null,
      slides: Array.isArray(s?.slide_urls) && s!.slide_urls.length >= 2 ? s!.slide_urls.length : 0,
      publishedAt: iso(p.published_at),
      metrics: metrics[String(p.id)] ?? null,
      funnel: p.funnel ?? null,
    };
  });
}

const COLUMNS = 'id,channel,hook,body,published_at,scheduled_post_id';

export async function listPublished(t: TenantDb, limit = 60): Promise<PublishedItem[]> {
  const { data, error } = await t
    .select('posts', COLUMNS)
    .eq('is_dry_run', false)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Falha ao ler os publicados: ${error.message}`);
  return assemble(t, (data ?? []) as unknown as PostRow[]);
}

export async function getPublished(t: TenantDb, id: string): Promise<PublishedItem | null> {
  const query = (columns: string) => t.select('posts', columns).eq('id', id).eq('is_dry_run', false).limit(1);
  let { data, error } = await query(`${COLUMNS},funnel`);
  // Sem a 0010, posts.funnel não existe (42703): segue sem o funil.
  if (error?.code === '42703') ({ data, error } = await query(COLUMNS));
  if (error) throw new Error(`Falha ao ler o post publicado: ${error.message}`);
  const row = (data ?? [])[0] as unknown as PostRow | undefined;
  if (!row) return null;
  const [item] = await assemble(t, [row]);
  return item;
}

// "182", "12,4 mil": o número como o Instagram mostra. Sem leitura: "sem dado".
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'sem dado';
  return new Intl.NumberFormat('pt-BR', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}

// Taxa de engajamento (interações sobre alcance, 0 a 1) em porcentagem com uma casa: "9,6%".
export function fmtRate(r: number | null | undefined): string {
  if (r === null || r === undefined) return 'sem dado';
  return `${(r * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
