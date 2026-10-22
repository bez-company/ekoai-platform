// instagram-metrics-model.ts: regras puras da coleta de métricas do Instagram (BEZ-183). Sem I/O: lê o
// retorno da Graph API, decide quais posts coletar e calcula o engajamento. O lado com rede e banco
// fica em instagram-metrics.ts.
//
// Duas fontes, com permissões diferentes da Meta:
//  - campos do post (`like_count`, `comments_count`): vêm com instagram_business_basic, que o app já pede;
//  - insights (alcance, salvos, compartilhamentos, visualizações, interações): exigem
//    instagram_business_manage_insights, que o pedido de revisão atual não inclui. Sem ela, esses ficam nulos.

export const INSIGHTS_SCOPE = 'instagram_business_manage_insights';
export const INSIGHT_METRICS = ['reach', 'saved', 'shares', 'views', 'total_interactions'] as const;

// Coleta os posts dos últimos 30 dias: depois disso o número quase não muda.
export const WINDOW_DAYS = 30;
const HOUR = 3_600_000;

export type PostMetrics = {
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  views: number | null;
  interactions: number | null;
};

export const EMPTY_METRICS: PostMetrics = { likes: null, comments: null, saves: null, shares: null, reach: null, views: null, interactions: null };

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

// GET /{media-id}?fields=like_count,comments_count
export function parseMediaFields(json: unknown): Pick<PostMetrics, 'likes' | 'comments'> {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return { likes: count(o.like_count), comments: count(o.comments_count) };
}

// GET /{media-id}/insights?metric=...: cada métrica vem em `values[0].value` ou em `total_value.value`.
export function parseInsights(json: unknown): Pick<PostMetrics, 'reach' | 'saves' | 'shares' | 'views' | 'interactions'> {
  const out = { reach: null, saves: null, shares: null, views: null, interactions: null } as Pick<PostMetrics, 'reach' | 'saves' | 'shares' | 'views' | 'interactions'>;
  const data = json && typeof json === 'object' ? (json as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return out;
  const key: Record<string, keyof typeof out> = { reach: 'reach', saved: 'saves', shares: 'shares', views: 'views', total_interactions: 'interactions' };
  for (const m of data) {
    if (!m || typeof m !== 'object') continue;
    const { name, values, total_value: total } = m as { name?: unknown; values?: unknown; total_value?: { value?: unknown } };
    const field = typeof name === 'string' ? key[name] : undefined;
    if (!field) continue;
    const first = Array.isArray(values) ? (values[0] as { value?: unknown } | undefined)?.value : undefined;
    out[field] = count(first ?? total?.value);
  }
  return out;
}

// O id do post no Instagram, gravado em posts.channels pela publicação (publish.ts).
export function mediaIdOf(channels: unknown): string | null {
  const ig = channels && typeof channels === 'object' ? (channels as { instagram?: { id?: unknown } }).instagram : null;
  const id = ig?.id;
  return typeof id === 'string' && /^\d{5,30}$/.test(id) ? id : null;
}

// Posts novos mudam rápido: coleta a cada 5 h nos 2 primeiros dias, depois uma vez por dia.
export function isDue(publishedAt: string, lastCapturedAt: string | null, nowMs: number): boolean {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published) || nowMs - published > WINDOW_DAYS * 24 * HOUR) return false;
  if (!lastCapturedAt) return true;
  const gap = nowMs - published < 48 * HOUR ? 5 * HOUR : 20 * HOUR;
  return nowMs - Date.parse(lastCapturedAt) >= gap;
}

// Engajamento = interações / alcance. Sem alcance (sem a permissão de insights), não há taxa.
export function engagementRate(m: PostMetrics): number | null {
  if (!m.reach) return null;
  const parts = [m.likes, m.comments, m.saves, m.shares].filter((v): v is number => v !== null);
  const interactions = m.interactions ?? (parts.length ? parts.reduce((a, b) => a + b, 0) : null);
  if (interactions === null) return null;
  return Math.round((interactions / m.reach) * 10000) / 10000;
}

// A Graph API responde erro como { error: { code, error_subcode } }. 190 = token inválido ou retirado
// (a renovação diária cuida de pedir para reconectar); 10 e 200 = permissão que falta; 100 com subcódigo
// 33 = o post não existe mais (apagado no Instagram).
export type GraphFailure = 'token' | 'permission' | 'gone' | 'other';

export function graphFailure(json: unknown): GraphFailure {
  const e = json && typeof json === 'object' ? (json as { error?: { code?: unknown; error_subcode?: unknown } }).error : null;
  const code = typeof e?.code === 'number' ? e.code : null;
  if (code === 190) return 'token';
  if (code === 10 || code === 200) return 'permission';
  if (code === 100 && e?.error_subcode === 33) return 'gone';
  return 'other';
}
