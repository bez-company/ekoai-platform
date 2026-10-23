// company-facts-model.ts: a base de fatos da empresa (SPEC 012, decisão 5). Puro, sem I/O. Um fato
// é algo que a empresa pode afirmar, com a fonte de onde veio; um "nunca afirmar" é o que o post não
// pode dizer (claim sensível, promessa, número que não se confirma). Os limites espelham os `check`
// da migration 0023 e 0037; aqui a pessoa recebe a mensagem de cada campo.
//
// Um fato só vale se uma pessoa o confirmou e ele está dentro da validade (ADR 0019). Fato escrito por
// agente ou importação nasce `pending`. Vencido é derivado de `valid_until` e da data de hoje, nunca
// gravado. "Nunca afirmar" vale sempre que estiver ativo; só `rejected` o desliga.

export const FACT_KINDS = ['fact', 'never'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_SOURCES = ['site', 'owner', 'other'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const SOURCE_LABEL: Record<FactSource, string> = { site: 'Site da empresa', owner: 'Quem administra a conta', other: 'Outra fonte' };

export const FACT_STATUSES = ['pending', 'confirmed', 'rejected'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const FACT_CATEGORIES = ['oferta_preco', 'prazo_horario', 'contato_endereco', 'numero_resultado', 'certificacao_regra', 'sobre_a_empresa', 'outro'] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<FactCategory, string> = {
  oferta_preco: 'Oferta e preço',
  prazo_horario: 'Prazo e horário',
  contato_endereco: 'Contato e endereço',
  numero_resultado: 'Número e resultado',
  certificacao_regra: 'Certificação e regra',
  sobre_a_empresa: 'Sobre a empresa',
  outro: 'Outro',
};

// Validade sugerida ao criar, em dias. A pessoa edita; sem categoria na lista, o fato não vence.
export const DEFAULT_VALIDITY_DAYS: Partial<Record<FactCategory, number>> = { oferta_preco: 30, prazo_horario: 90, numero_resultado: 180 };
export const EXPIRY_SOON_DAYS = 7;
export const CONFIRM_MANY_MAX = 50;
export const TZ_OFFSET_HOURS = -3;

export const FACT_MAX = 280;
export const SOURCE_NOTE_MAX = 200;
export const MAX_FACTS_PER_ACCOUNT = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompanyFact = {
  id: string;
  kind: FactKind;
  text: string;
  source: FactSource;
  sourceNote: string | null;
  active: boolean;
  createdAt: string;
  status: FactStatus;
  category: FactCategory;
  proposedBy: 'person' | 'agent';
  verifiedAt: string | null;
  approvedBy: string | null;
  validUntil: string | null; // AAAA-MM-DD, dia local
  expiryNotice: 'soon' | 'expired' | null;
};

export type FactInput = { kind: FactKind; text: string; source: FactSource; source_note: string | null; category: FactCategory; valid_until: string | null };
export type FactPatch = { id: string; active?: boolean; text?: string; source?: FactSource; source_note?: string | null; category?: FactCategory; valid_until?: string | null };
// O que o agente ou a importação pode gravar. Sempre `pending`, sempre `agent`: não há campo para mudar isso.
export type AgentFactInput = { kind: 'fact'; text: string; source: FactSource; source_note: string | null; category: FactCategory; valid_until: string | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function parseText(raw: unknown, kind: FactKind): Parsed<string> {
  const text = clean(raw);
  if (!text) return { ok: false, error: kind === 'never' ? 'Diga o que a empresa nunca afirma.' : 'Escreva o fato em uma frase.', field: 'text' };
  if (text.length > FACT_MAX) return { ok: false, error: `Use até ${FACT_MAX} caracteres.`, field: 'text' };
  return { ok: true, value: text };
}

function parseNote(raw: unknown): Parsed<string | null> {
  const note = clean(raw);
  if (!note) return { ok: true, value: null };
  if (note.length > SOURCE_NOTE_MAX) return { ok: false, error: `A fonte aceita até ${SOURCE_NOTE_MAX} caracteres.`, field: 'source_note' };
  return { ok: true, value: note };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Dia local (AAAA-MM-DD) de um instante. O planejador e o aviso de vencimento usam a mesma conta.
export function todayLocal(now: Date = new Date(), offsetHours: number = TZ_OFFSET_HOURS): string {
  return new Date(now.getTime() + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Validade sugerida pela categoria (decisão 4 da SPEC 018); nula quando a categoria não vence.
export function suggestedValidUntil(category: FactCategory, today: string = todayLocal()): string | null {
  const days = DEFAULT_VALIDITY_DAYS[category];
  return days ? addDays(today, days) : null;
}

function parseCategory(raw: unknown): Parsed<FactCategory> {
  const category = clean(raw) || 'outro';
  if (!(FACT_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: 'Escolha uma categoria da lista.', field: 'category' };
  return { ok: true, value: category as FactCategory };
}

// `undefined` = a pessoa não mexeu (vale a sugestão da categoria); vazio ou null = sem validade.
function parseValidUntil(raw: unknown, today: string): Parsed<string | null> {
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return { ok: true, value: null };
  if (typeof raw !== 'string' || !isCalendarDate(raw.trim())) return { ok: false, error: 'Use uma data válida, no formato AAAA-MM-DD.', field: 'valid_until' };
  const day = raw.trim();
  if (day < today) return { ok: false, error: 'A data de validade já passou. Escolha uma data de hoje em diante.', field: 'valid_until' };
  return { ok: true, value: day };
}

export function parseFactInput(body: unknown, today: string = todayLocal()): Parsed<FactInput> {
  const b = obj(body);
  const kind = b.kind;
  if (kind !== 'fact' && kind !== 'never') return { ok: false, error: 'Escolha entre fato e nunca afirmar.', field: 'kind' };
  const text = parseText(b.text, kind);
  if (!text.ok) return text;
  const source = clean(b.source) || 'owner';
  if (!(FACT_SOURCES as readonly string[]).includes(source)) return { ok: false, error: 'Escolha de onde o fato veio.', field: 'source' };
  const note = parseNote(b.source_note);
  if (!note.ok) return note;
  // "Nunca afirmar" não tem categoria nem prazo: vale sempre.
  if (kind === 'never') return { ok: true, value: { kind, text: text.value, source: source as FactSource, source_note: note.value, category: 'outro', valid_until: null } };
  const category = parseCategory(b.category);
  if (!category.ok) return category;
  const validUntil = b.valid_until === undefined ? ({ ok: true, value: suggestedValidUntil(category.value, today) } as const) : parseValidUntil(b.valid_until, today);
  if (!validUntil.ok) return validUntil;
  return { ok: true, value: { kind, text: text.value, source: source as FactSource, source_note: note.value, category: category.value, valid_until: validUntil.value } };
}

// O que a importação do site ou um agente grava: só fato, sempre pendente. A URL da fonte é https.
export function parseAgentFactInput(body: unknown, today: string = todayLocal()): Parsed<AgentFactInput> {
  const b = obj(body);
  const text = parseText(b.text, 'fact');
  if (!text.ok) return text;
  const note = parseNote(b.source_note);
  if (!note.ok) return note;
  if (b.source === 'site' && note.value && !/^https:\/\//i.test(note.value)) return { ok: false, error: 'A fonte do site precisa ser um endereço https.', field: 'source_note' };
  const source = clean(b.source) || 'site';
  if (!(FACT_SOURCES as readonly string[]).includes(source)) return { ok: false, error: 'Escolha de onde o fato veio.', field: 'source' };
  const category = parseCategory(b.category);
  if (!category.ok) return category;
  return { ok: true, value: { kind: 'fact', text: text.value, source: source as FactSource, source_note: note.value, category: category.value, valid_until: suggestedValidUntil(category.value, today) } };
}

export function parseFactPatch(body: unknown, today: string = todayLocal()): Parsed<FactPatch> {
  const b = obj(body);
  if (typeof b.id !== 'string' || !UUID.test(b.id)) return { ok: false, error: 'Fato não encontrado. Recarregue a página.' };
  const patch: FactPatch = { id: b.id };
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return { ok: false, error: 'Ligar ou desligar: valor inválido.', field: 'active' };
    patch.active = b.active;
  }
  if (b.text !== undefined) {
    const text = parseText(b.text, 'fact');
    if (!text.ok) return text;
    patch.text = text.value;
  }
  if (b.source !== undefined) {
    const source = clean(b.source);
    if (!(FACT_SOURCES as readonly string[]).includes(source)) return { ok: false, error: 'Escolha de onde o fato veio.', field: 'source' };
    patch.source = source as FactSource;
  }
  if (b.source_note !== undefined) {
    const note = parseNote(b.source_note);
    if (!note.ok) return note;
    patch.source_note = note.value;
  }
  if (b.category !== undefined) {
    const category = parseCategory(b.category);
    if (!category.ok) return category;
    patch.category = category.value;
  }
  if (b.valid_until !== undefined) {
    const validUntil = parseValidUntil(b.valid_until, today);
    if (!validUntil.ok) return validUntil;
    patch.valid_until = validUntil.value;
  }
  if (Object.keys(patch).length === 1) return { ok: false, error: 'Nada para alterar.' };
  return { ok: true, value: patch };
}

// Confirmar vários de uma vez: só os ids que a pessoa marcou, sem "todos".
export function parseConfirmMany(body: unknown): Parsed<string[]> {
  const ids = obj(body).ids;
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'Marque ao menos um fato para confirmar.', field: 'ids' };
  if (ids.length > CONFIRM_MANY_MAX) return { ok: false, error: `Confirme até ${CONFIRM_MANY_MAX} fatos por vez.`, field: 'ids' };
  const list = ids.map((id) => (typeof id === 'string' ? id : ''));
  if (list.some((id) => !UUID.test(id))) return { ok: false, error: 'Fato não encontrado. Recarregue a página.', field: 'ids' };
  return { ok: true, value: [...new Set(list)] };
}

export function factFromRow(row: Record<string, unknown>): CompanyFact {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' && v ? v : null);
  // `date` do pg chega como Date à meia-noite local do servidor ou como texto: normaliza para AAAA-MM-DD.
  const day = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : typeof v === 'string' && v ? v.slice(0, 10) : null);
  return {
    id: String(row.id),
    kind: row.kind as FactKind,
    text: String(row.text),
    source: row.source as FactSource,
    sourceNote: typeof row.source_note === 'string' ? row.source_note : null,
    active: row.active !== false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
    status: (FACT_STATUSES as readonly string[]).includes(String(row.status)) ? (row.status as FactStatus) : 'confirmed',
    category: (FACT_CATEGORIES as readonly string[]).includes(String(row.category)) ? (row.category as FactCategory) : 'outro',
    proposedBy: row.proposed_by === 'agent' ? 'agent' : 'person',
    verifiedAt: iso(row.verified_at),
    approvedBy: typeof row.approved_by === 'string' ? row.approved_by : null,
    validUntil: day(row.valid_until),
    expiryNotice: row.expiry_notice === 'soon' || row.expiry_notice === 'expired' ? row.expiry_notice : null,
  };
}

export type FactStanding = 'valid' | 'soon' | 'pending' | 'rejected' | 'expired' | 'off';

// Em que pé o fato está hoje. `valid` e `soon` (vence em até 7 dias) entram nos posts; o resto não.
// "Nunca afirmar" fica `valid` sempre que estiver ativo e não recusado.
export function factStanding(fact: CompanyFact, today: string = todayLocal()): { state: FactStanding; daysLeft: number | null } {
  if (!fact.active) return { state: 'off', daysLeft: null };
  if (fact.status === 'rejected') return { state: 'rejected', daysLeft: null };
  if (fact.kind === 'never') return { state: 'valid', daysLeft: null };
  if (fact.status === 'pending') return { state: 'pending', daysLeft: null };
  if (!fact.validUntil) return { state: 'valid', daysLeft: null };
  const left = daysBetween(today, fact.validUntil);
  if (left < 0) return { state: 'expired', daysLeft: left };
  return { state: left <= EXPIRY_SOON_DAYS ? 'soon' : 'valid', daysLeft: left };
}

// O que o agente recebe: só o que vale hoje, separado em "pode afirmar" e "nunca afirmar". O que não vale
// (pendente, recusado ou vencido) vai à parte, só para o revisor reprovar número que veio de lá.
export type InactiveFact = { text: string; reason: 'expired' | 'pending' | 'rejected'; validUntil: string | null };

export function factsForPrompt(facts: readonly CompanyFact[], today: string = todayLocal()): { facts: string[]; never: string[]; inactive: InactiveFact[] } {
  const out = { facts: [] as string[], never: [] as string[], inactive: [] as InactiveFact[] };
  for (const f of facts) {
    const { state } = factStanding(f, today);
    if (state === 'valid' || state === 'soon') (f.kind === 'never' ? out.never : out.facts).push(f.text);
    else if (f.kind === 'fact' && (state === 'expired' || state === 'pending' || state === 'rejected')) out.inactive.push({ text: f.text, reason: state, validUntil: f.validUntil });
  }
  return out;
}
