// content-analysis-model.ts: regras puras da análise dos posts publicados (SPEC 022, BEZ-206): o que
// funciona por tipo, formato e objetivo, a frase de aprendizado e a recomendação de horários. Sem I/O: o
// lado com banco fica em content-analysis.ts.
//
// Isto compara os posts da própria conta entre si. Não prova que o tipo causa o resultado, e a tela diz
// isso. Grupo com poucos posts aparece, mas não entra em conclusão nenhuma.

import { GOALS, isPostGoal, type PostGoal } from './post-goals';

// Menos posts que isso num grupo: aparece cinza e não entra na frase.
export const MIN_GROUP = 4;
// Só compara e recomenda com esta quantidade de posts com alcance.
export const MIN_POSTS = 12;
// A recomendação só vale com posts em pelo menos este número de horários diferentes.
export const MIN_DISTINCT_HOURS = 3;
export const WINDOW_DAYS = 60;
// Quantos posts "de reserva" puxam a média de uma célula para a média da conta (evita um post sortudo mandar).
const SHRINK = 3;
// Distância mínima entre dois horários sugeridos no mesmo dia.
const MIN_GAP_HOURS = 3;
export const MAX_SLOTS = 3;

export type PostKind = 'informativo' | 'atmosfera';

export type AnalysisPost = {
  id: string;
  title: string;
  publishedAt: string; // ISO, UTC
  kind: PostKind | null;
  format: string | null; // media_kind do agendamento: image, carousel, text...
  goal: PostGoal | null;
  engagement: number | null; // interações / alcance (0 a 1); sem alcance, nulo
};

export type Group = { key: string; label: string; n: number; avg: number; low: boolean };

export type Breakdown = {
  // Posts com alcance, que são os que entram na conta.
  counted: number;
  ready: boolean;
  kind: Group[];
  format: Group[];
  goal: Group[];
  best: AnalysisPost | null;
};

const KIND_LABEL: Record<PostKind, string> = { informativo: 'Informativo', atmosfera: 'Atmosfera' };
const FORMAT_LABEL: Record<string, string> = { image: 'Imagem única', carousel: 'Carrossel', text: 'Só texto', document: 'Documento', video: 'Vídeo', thread: 'Thread', story: 'Story' };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function groupBy(posts: AnalysisPost[], keyOf: (p: AnalysisPost) => string | null, labelOf: (key: string) => string): Group[] {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of posts) {
    const key = keyOf(p);
    if (!key || p.engagement === null) continue;
    const g = sums.get(key) ?? { sum: 0, n: 0 };
    g.sum += p.engagement;
    g.n += 1;
    sums.set(key, g);
  }
  return [...sums.entries()]
    .map(([key, g]) => ({ key, label: labelOf(key), n: g.n, avg: round4(g.sum / g.n), low: g.n < MIN_GROUP }))
    .sort((a, b) => Number(a.low) - Number(b.low) || b.avg - a.avg || b.n - a.n);
}

// A janela é dos últimos `WINDOW_DAYS` dias; quem chama já filtra, aqui só se calcula.
export function contentBreakdown(posts: AnalysisPost[]): Breakdown {
  const counted = posts.filter((p) => p.engagement !== null);
  const best = counted.reduce<AnalysisPost | null>((top, p) => (top === null || (p.engagement as number) > (top.engagement as number) ? p : top), null);
  return {
    counted: counted.length,
    ready: counted.length >= MIN_POSTS,
    kind: groupBy(counted, (p) => p.kind, (k) => KIND_LABEL[k as PostKind] ?? k),
    format: groupBy(counted, (p) => p.format, (k) => FORMAT_LABEL[k] ?? k),
    goal: groupBy(counted, (p) => p.goal, (k) => (isPostGoal(k) ? GOALS[k].label : k)),
    best,
  };
}

const ratio = (n: number) => n.toFixed(1).replace('.', ',');

// A frase do aprendizado, por template e só com números. Compara os dois tipos quando ambos têm posts
// suficientes e um rende pelo menos 20% a mais.
export function insightSentence(b: Breakdown): { text: string; evidence: string } | null {
  if (!b.ready) return null;
  const info = b.kind.find((g) => g.key === 'informativo' && !g.low);
  const atm = b.kind.find((g) => g.key === 'atmosfera' && !g.low);
  if (!info || !atm || info.avg <= 0 || atm.avg <= 0) return null;
  const [top, other] = info.avg >= atm.avg ? [info, atm] : [atm, info];
  const times = top.avg / other.avg;
  if (times < 1.2) return null;
  const noun = (k: string) => (k === 'informativo' ? 'informativos' : 'de atmosfera');
  const text = top.key === 'informativo' ? `Posts informativos renderam ${ratio(times)} vez o engajamento dos de atmosfera.` : `Posts de atmosfera renderam ${ratio(times)} vez o engajamento dos informativos.`;
  const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')}%`;
  return { text, evidence: `${top.n} posts ${noun(top.key)} (${pct(top.avg)}) contra ${other.n} ${other.key === 'informativo' ? 'informativos' : 'de atmosfera'} (${pct(other.avg)})` };
}

// ── Horários recomendados ────────────────────────────────────────────────────────────────────────

export type RecommendedSlot = { weekday: number; hour: number; minute: number; score: number; n: number };

export type Recommendation =
  | { ok: true; slots: RecommendedSlot[]; basedOn: number; usedOnline: boolean }
  | { ok: false; reason: 'few_posts' | 'few_hours'; have: number; need: number };

// Hora local (0 a 23) e dia da semana (0 = domingo) de um instante UTC, no fuso `tzOffsetHours` (BRT = -3).
export function localParts(iso: string, tzOffsetHours: number): { weekday: number; hour: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + tzOffsetHours * 3_600_000);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

// Pontua cada dia da semana x faixa de 2 h pelo engajamento médio dos posts que saíram ali, puxado para a
// média da conta quando a célula tem poucos posts. Com o horário online dos seguidores (0 a 1, por hora),
// o placar sobe ou desce até 25% pela hora: o público online reforça, não decide sozinho.
export function recommendSlots(posts: AnalysisPost[], opts: { tzOffsetHours: number; onlineHours?: number[] | null }): Recommendation {
  const rated = posts.filter((p) => p.engagement !== null);
  if (rated.length < MIN_POSTS) return { ok: false, reason: 'few_posts', have: rated.length, need: MIN_POSTS };
  const parts = rated
    .map((p) => ({ p, at: localParts(p.publishedAt, opts.tzOffsetHours) }))
    .filter((x): x is { p: AnalysisPost; at: { weekday: number; hour: number } } => x.at !== null);
  const distinct = new Set(parts.map((x) => x.at.hour)).size;
  if (distinct < MIN_DISTINCT_HOURS) return { ok: false, reason: 'few_hours', have: distinct, need: MIN_DISTINCT_HOURS };

  const mean = parts.reduce((s, x) => s + (x.p.engagement as number), 0) / parts.length;
  const cells = new Map<string, { weekday: number; band: number; sum: number; n: number; top: { hour: number; engagement: number } }>();
  for (const { p, at } of parts) {
    const band = Math.floor(at.hour / 2);
    const key = `${at.weekday}-${band}`;
    const e = p.engagement as number;
    const c = cells.get(key) ?? { weekday: at.weekday, band, sum: 0, n: 0, top: { hour: at.hour, engagement: -1 } };
    c.sum += e;
    c.n += 1;
    if (e > c.top.engagement) c.top = { hour: at.hour, engagement: e };
    cells.set(key, c);
  }
  const online = opts.onlineHours && opts.onlineHours.length === 24 ? opts.onlineHours : null;
  const scored = [...cells.values()]
    .map((c) => {
      const shrunk = (c.sum + SHRINK * mean) / (c.n + SHRINK);
      const hour = c.top.hour; // o horário em que o melhor post da célula saiu
      const tilt = online ? 0.75 + 0.25 * (online[hour] ?? 0) : 1;
      return { weekday: c.weekday, hour, minute: 0, score: round4(shrunk * tilt), n: c.n };
    })
    .sort((a, b) => b.score - a.score || b.n - a.n || a.weekday - b.weekday || a.hour - b.hour);

  const slots: RecommendedSlot[] = [];
  for (const s of scored) {
    if (slots.length === MAX_SLOTS) break;
    // Dois horários no mesmo dia precisam estar a pelo menos 3 h um do outro, senão um canibaliza o outro.
    if (slots.some((o) => o.weekday === s.weekday && Math.abs(o.hour - s.hour) < MIN_GAP_HOURS)) continue;
    slots.push(s);
  }
  slots.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  return { ok: true, slots, basedOn: rated.length, usedOnline: online !== null };
}

// Engajamento médio dos posts por hora em que saíram, de 0 a 1 relativo à melhor hora. Hora sem post é nula.
// É o gráfico de horários quando a Meta não devolve o horário em que os seguidores estão online.
export function ownHourly(posts: AnalysisPost[], tzOffsetHours: number): (number | null)[] {
  const sums = new Array<number>(24).fill(0);
  const counts = new Array<number>(24).fill(0);
  for (const p of posts) {
    if (p.engagement === null) continue;
    const at = localParts(p.publishedAt, tzOffsetHours);
    if (!at) continue;
    sums[at.hour] += p.engagement;
    counts[at.hour] += 1;
  }
  const avg = sums.map((s, h) => (counts[h] ? s / counts[h] : null));
  const peak = Math.max(0, ...avg.map((v) => v ?? 0));
  return avg.map((v) => (v === null ? null : peak > 0 ? round4(v / peak) : 0));
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAY_CAP = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// "Ter 19h, Sex 11h, Sáb 10h"
export function describeSlots(slots: Pick<RecommendedSlot, 'weekday' | 'hour' | 'minute'>[]): string {
  return slots.map((s) => `${WEEKDAY_CAP[s.weekday]} ${s.hour}h${s.minute ? String(s.minute).padStart(2, '0') : ''}`).join(', ');
}

export const weekdayShort = (d: number) => WEEKDAY_SHORT[d] ?? '';
