// campaign-model.ts: a campanha de uma conta (SPEC 018, BEZ-262). Puro, sem I/O. A campanha diz ao coordenador
// o que a empresa quer alcançar; o coordenador usa só a campanha ativa, confirmada e dentro do prazo. O texto
// livre (oferta, público, restrições) só entra na ideia do post: quem escolhe objetivo, horário e foto é a
// regra do planejador (content-plan-model.ts), a partir do tipo. Os limites espelham os `check` da migration
// 0038; aqui a pessoa recebe a mensagem de cada campo.

import type { PostGoal } from './post-goals';

export const CAMPAIGN_KINDS = ['divulgar', 'vender', 'captar', 'relacionar', 'marca'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const KIND_LABEL: Record<CampaignKind, string> = {
  divulgar: 'Divulgar',
  vender: 'Vender',
  captar: 'Captar contatos',
  relacionar: 'Aproximar do público',
  marca: 'Fortalecer a marca',
};

export const KIND_HINT: Record<CampaignKind, { when: string; example: string }> = {
  divulgar: { when: 'Evento, agenda, data ou lançamento', example: 'Agenda de novembro' },
  vender: { when: 'Produto ou serviço com oferta', example: 'Caixas de fim de ano' },
  captar: { when: 'Pedidos de orçamento e mensagens', example: 'Mesas de doces para casamento' },
  relacionar: { when: 'Bastidores e conversa', example: 'Conheça a equipe' },
  marca: { when: 'Ensinar e mostrar como trabalha', example: 'Como fazemos o bolo' },
};

// Os objetivos de post que cada tipo puxa (decisão 3 da SPEC 018). A rotação do planejador escolhe entre eles.
export const KIND_GOALS: Record<CampaignKind, readonly PostGoal[]> = {
  divulgar: ['novidade', 'bastidores', 'conversa'],
  vender: ['produto', 'promocao', 'prova_social'],
  captar: ['conversa', 'produto', 'ensinar'],
  relacionar: ['bastidores', 'conversa', 'prova_social'],
  marca: ['ensinar', 'bastidores', 'produto'],
};

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'ended', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CTAS = ['link_bio', 'whatsapp', 'dm'] as const;
export type Cta = (typeof CTAS)[number];

export const NAME_MAX = 80;
export const TEXT_MAX = 280;
export const RESTRICTION_MAX = 150;
export const RESTRICTIONS_MAX = 5;
export const TARGET_LABEL_MAX = 80;
export const TARGET_VALUE_MAX = 1_000_000_000;
// Teto de horários da semana que a campanha pode ocupar (decisão 5 da SPEC 018).
export const CAMPAIGN_SHARE = 0.6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Campaign = {
  id: string;
  slug: string;
  name: string;
  kind: CampaignKind | null;
  objective: string | null;
  offering: string | null;
  audience: string | null;
  cta: Cta | null;
  restrictions: string[];
  targetLabel: string | null;
  targetValue: number | null;
  postsPerWeek: number | null;
  startDate: string | null; // AAAA-MM-DD, dia local
  endDate: string | null;
  status: CampaignStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
};

export type CampaignInput = {
  name: string;
  kind: CampaignKind;
  objective: string;
  offering: string;
  audience: string;
  cta: Cta | null;
  restrictions: string[];
  target_label: string | null;
  target_value: number | null;
  posts_per_week: number | null;
  start_date: string;
  end_date: string;
};
export type CampaignPatch = Partial<CampaignInput>;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

const obj = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {});
const clean = (value: unknown): string => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const fail = (error: string, field: string): { ok: false; error: string; field: string } => ({ ok: false, error, field });

export const isCampaignId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function todayLocal(now: Date = new Date(), offsetHours = -3): string {
  return new Date(now.getTime() + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function text(raw: unknown, max: number, field: string, empty: string): Parsed<string> {
  const v = clean(raw);
  if (!v) return fail(empty, field);
  if (v.length > max) return fail(`Use até ${max} caracteres.`, field);
  return { ok: true, value: v };
}

function parseKind(raw: unknown): Parsed<CampaignKind> {
  const v = clean(raw);
  if (!(CAMPAIGN_KINDS as readonly string[]).includes(v)) return fail('Escolha o tipo que mais se parece com a campanha.', 'kind');
  return { ok: true, value: v as CampaignKind };
}

function parseCta(raw: unknown): Parsed<Cta | null> {
  const v = clean(raw);
  if (!v) return { ok: true, value: null }; // vazio usa a chamada do perfil
  if (!(CTAS as readonly string[]).includes(v)) return fail('Escolha uma chamada da lista.', 'cta');
  return { ok: true, value: v as Cta };
}

function parseRestrictions(raw: unknown): Parsed<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('Use uma lista de restrições.', 'restrictions');
  const items = [...new Set(raw.map(clean).filter(Boolean))];
  if (items.length > RESTRICTIONS_MAX) return fail(`Use até ${RESTRICTIONS_MAX} restrições.`, 'restrictions');
  if (items.some((i) => i.length > RESTRICTION_MAX)) return fail(`Cada restrição aceita até ${RESTRICTION_MAX} caracteres.`, 'restrictions');
  if (items.join('\n').length > 750) return fail('As restrições passam do limite de 750 caracteres.', 'restrictions');
  return { ok: true, value: items };
}

function parseTarget(label: unknown, value: unknown): Parsed<{ label: string | null; value: number | null }> {
  const l = clean(label);
  const noValue = value === undefined || value === null || value === '';
  if (!l && noValue) return { ok: true, value: { label: null, value: null } };
  if (l.length > TARGET_LABEL_MAX) return fail(`A meta aceita até ${TARGET_LABEL_MAX} caracteres.`, 'target_label');
  if (!l) return fail('Diga o que a meta mede, por exemplo "pedidos pelo WhatsApp".', 'target_label');
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (noValue) return { ok: true, value: { label: l, value: null } };
  if (!Number.isInteger(n) || n < 0 || n > TARGET_VALUE_MAX) return fail('Use um número inteiro, de zero em diante.', 'target_value');
  return { ok: true, value: { label: l, value: n } };
}

function parsePosts(raw: unknown): Parsed<number | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }; // vazio usa o do perfil
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > 14) return fail('Use de 1 a 14 posts por semana.', 'posts_per_week');
  return { ok: true, value: n };
}

function parseDay(raw: unknown, field: string, empty: string): Parsed<string> {
  const v = clean(raw);
  if (!v) return fail(empty, field);
  if (!isCalendarDate(v)) return fail('Use uma data válida.', field);
  return { ok: true, value: v };
}

export function parseCampaignInput(body: unknown, today: string = todayLocal()): Parsed<CampaignInput> {
  const b = obj(body);
  const name = text(b.name, NAME_MAX, 'name', 'Dê um nome à campanha.');
  if (!name.ok) return name;
  const objective = text(b.objective, TEXT_MAX, 'objective', 'Diga o que você quer alcançar, em uma frase.');
  if (!objective.ok) return objective;
  const kind = parseKind(b.kind);
  if (!kind.ok) return kind;
  const offering = text(b.offering, TEXT_MAX, 'offering', 'Diga o que entra nos posts: o que você vende ou divulga.');
  if (!offering.ok) return offering;
  const audience = text(b.audience, TEXT_MAX, 'audience', 'Diga para quem são os posts.');
  if (!audience.ok) return audience;
  const start = b.start_date === undefined || clean(b.start_date) === '' ? ({ ok: true, value: today } as const) : parseDay(b.start_date, 'start_date', '');
  if (!start.ok) return start;
  const end = parseDay(b.end_date, 'end_date', 'Diga até quando a campanha vale.');
  if (!end.ok) return end;
  if (end.value < start.value) return fail('A data final vem depois da inicial.', 'end_date');
  const cta = parseCta(b.cta);
  if (!cta.ok) return cta;
  const restrictions = parseRestrictions(b.restrictions);
  if (!restrictions.ok) return restrictions;
  const target = parseTarget(b.target_label, b.target_value);
  if (!target.ok) return target;
  const posts = parsePosts(b.posts_per_week);
  if (!posts.ok) return posts;
  return {
    ok: true,
    value: { name: name.value, kind: kind.value, objective: objective.value, offering: offering.value, audience: audience.value, cta: cta.value, restrictions: restrictions.value, target_label: target.value.label, target_value: target.value.value, posts_per_week: posts.value, start_date: start.value, end_date: end.value },
  };
}

// Editar uma campanha: só os campos enviados mudam; cada um passa pela mesma regra da criação.
export function parseCampaignPatch(body: unknown, current: Pick<Campaign, 'startDate' | 'endDate'>, today: string = todayLocal()): Parsed<CampaignPatch> {
  const b = obj(body);
  const patch: CampaignPatch = {};
  const take = <T>(key: keyof CampaignInput, parsed: Parsed<T>): { ok: false; error: string; field?: string } | null => {
    if (!parsed.ok) return parsed;
    (patch as Record<string, unknown>)[key] = parsed.value;
    return null;
  };
  const checks: [keyof CampaignInput, () => Parsed<unknown>][] = [
    ['name', () => text(b.name, NAME_MAX, 'name', 'Dê um nome à campanha.')],
    ['objective', () => text(b.objective, TEXT_MAX, 'objective', 'Diga o que você quer alcançar, em uma frase.')],
    ['kind', () => parseKind(b.kind)],
    ['offering', () => text(b.offering, TEXT_MAX, 'offering', 'Diga o que entra nos posts: o que você vende ou divulga.')],
    ['audience', () => text(b.audience, TEXT_MAX, 'audience', 'Diga para quem são os posts.')],
    ['cta', () => parseCta(b.cta)],
    ['restrictions', () => parseRestrictions(b.restrictions)],
    ['posts_per_week', () => parsePosts(b.posts_per_week)],
    ['start_date', () => parseDay(b.start_date, 'start_date', 'Diga quando a campanha começa.')],
    ['end_date', () => parseDay(b.end_date, 'end_date', 'Diga até quando a campanha vale.')],
  ];
  for (const [key, run] of checks) {
    if (b[key] === undefined) continue;
    const err = take(key, run());
    if (err) return err as Parsed<never>;
  }
  if (b.target_label !== undefined || b.target_value !== undefined) {
    const target = parseTarget(b.target_label, b.target_value);
    if (!target.ok) return target;
    patch.target_label = target.value.label;
    patch.target_value = target.value.value;
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Nada para alterar.' };
  const start = patch.start_date ?? current.startDate ?? today;
  const end = patch.end_date ?? current.endDate;
  if (end && end < start) return fail('A data final vem depois da inicial.', 'end_date');
  return { ok: true, value: patch };
}

export function campaignFromRow(row: Record<string, unknown>): Campaign {
  // timestamptz chega como Date ou como texto com fuso ("...-03:00"): normaliza para ISO em UTC.
  const iso = (v: unknown) => {
    const d = v instanceof Date ? v : typeof v === 'string' && v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };
  // `date` do pg chega como Date local ou texto: normaliza para AAAA-MM-DD.
  const day = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : typeof v === 'string' && v ? v.slice(0, 10) : null);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    kind: (CAMPAIGN_KINDS as readonly string[]).includes(String(row.kind)) ? (row.kind as CampaignKind) : null,
    objective: str(row.objective),
    offering: str(row.offering),
    audience: str(row.audience),
    cta: (CTAS as readonly string[]).includes(String(row.cta)) ? (row.cta as Cta) : null,
    restrictions: Array.isArray(row.restrictions) ? row.restrictions.map(String) : [],
    targetLabel: str(row.target_label),
    targetValue: typeof row.target_value === 'number' ? row.target_value : null,
    postsPerWeek: typeof row.posts_per_week === 'number' ? row.posts_per_week : null,
    startDate: day(row.start_date),
    endDate: day(row.end_date),
    status: (CAMPAIGN_STATUSES as readonly string[]).includes(String(row.status)) ? (row.status as CampaignStatus) : 'draft',
    confirmedAt: iso(row.confirmed_at),
    confirmedBy: typeof row.confirmed_by === 'string' ? row.confirmed_by : null,
    createdAt: iso(row.created_at) ?? '',
  };
}

export type CampaignAction = 'confirm' | 'pause' | 'resume' | 'end' | 'archive';

// Ciclo: rascunho, ativa, pausada, encerrada, arquivada. Rascunho nunca confirmado pode ser arquivado.
const TRANSITIONS: Record<CampaignAction, { from: readonly CampaignStatus[]; to: CampaignStatus }> = {
  confirm: { from: ['draft'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  end: { from: ['active', 'paused'], to: 'ended' },
  archive: { from: ['draft', 'ended'], to: 'archived' },
};

export function transition(from: CampaignStatus, action: CampaignAction): CampaignStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(from) ? t.to : null;
}

export function dayCount(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

// A campanha entra no planejamento só quando está ativa, confirmada e dentro do prazo (início e fim inclusive).
export function campaignInEffect(c: Pick<Campaign, 'status' | 'confirmedAt' | 'startDate' | 'endDate'>, today: string = todayLocal()): boolean {
  if (c.status !== 'active' || !c.confirmedAt) return false;
  if (c.startDate && today < c.startDate) return false;
  if (c.endDate && today > c.endDate) return false;
  return true;
}

export function campaignSlug(name: string, suffix = ''): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const slug = base || 'campanha';
  return suffix ? `${slug}-${suffix}` : slug;
}

// Quantos horários da semana a campanha ocupa no máximo: 60% arredondado para cima, ao menos 1 e, havendo mais
// de um horário, sempre sobra um para a rotação (2 horários: 1 da campanha; 3: 2; 5: 3).
export function campaignSlotQuota(freeSlots: number): number {
  if (freeSlots <= 0) return 0;
  if (freeSlots === 1) return 1;
  return Math.min(Math.ceil(freeSlots * CAMPAIGN_SHARE), freeSlots - 1);
}

// ── Progresso (decisão 8 da SPEC 018) ──────────────────────────────────────────
// Mede posts, cadência e engajamento. Nunca venda: curtida, comentário e alcance não dizem quanto vendeu.

export type MetricSample = { likes: number | null; comments: number | null; rate: number | null };

export type EngagementCompare = { unit: 'rate' | 'interactions'; campaign: number | null; account: number | null; campaignPosts: number; accountPosts: number };

// Segunda a domingo do dia local: [início, fim) em AAAA-MM-DD.
export function weekBounds(today: string): { start: string; end: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - back * 86_400_000);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const hasAny = (s: MetricSample) => s.likes !== null || s.comments !== null || s.rate !== null;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// A mesma medida nos dois lados: se todo post tem taxa (interações / alcance), vale a taxa; se algum não tem
// (sem a permissão de insights), vale curtidas mais comentários. Sem amostra, nada: a tela não inventa número.
export function compareEngagement(campaign: readonly MetricSample[], account: readonly MetricSample[]): EngagementCompare {
  const c = campaign.filter(hasAny);
  const a = account.filter(hasAny);
  const unit = [...c, ...a].length > 0 && [...c, ...a].every((s) => s.rate !== null) ? 'rate' : 'interactions';
  const value = (s: MetricSample) => (unit === 'rate' ? (s.rate as number) : (s.likes ?? 0) + (s.comments ?? 0));
  return { unit, campaign: mean(c.map(value)), account: mean(a.map(value)), campaignPosts: c.length, accountPosts: a.length };
}

export type CampaignProgress = {
  daysLeft: number | null;
  daysTotal: number | null;
  suggested: number; // sugestões abertas
  created: number; // sugestões que viraram pedido de post
  scheduled: number; // aprovados, esperando a hora
  published: number;
  cadence: { thisWeek: number; target: number | null };
  engagement: EngagementCompare;
};
