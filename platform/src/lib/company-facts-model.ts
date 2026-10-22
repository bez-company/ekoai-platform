// company-facts-model.ts: a base de fatos da empresa (SPEC 012, decisão 5). Puro, sem I/O. Um fato
// é algo que a empresa pode afirmar, com a fonte de onde veio; um "nunca afirmar" é o que o post não
// pode dizer (claim sensível, promessa, número que não se confirma). Os limites espelham os `check`
// da migration 0023; aqui a pessoa recebe a mensagem de cada campo.

export const FACT_KINDS = ['fact', 'never'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_SOURCES = ['site', 'owner', 'other'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const SOURCE_LABEL: Record<FactSource, string> = { site: 'Site da empresa', owner: 'Quem administra a conta', other: 'Outra fonte' };

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
};

export type FactInput = { kind: FactKind; text: string; source: FactSource; source_note: string | null };
export type FactPatch = { id: string; active?: boolean; text?: string; source?: FactSource; source_note?: string | null };

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

export function parseFactInput(body: unknown): Parsed<FactInput> {
  const b = obj(body);
  const kind = b.kind;
  if (kind !== 'fact' && kind !== 'never') return { ok: false, error: 'Escolha entre fato e nunca afirmar.', field: 'kind' };
  const text = parseText(b.text, kind);
  if (!text.ok) return text;
  const source = clean(b.source) || 'owner';
  if (!(FACT_SOURCES as readonly string[]).includes(source)) return { ok: false, error: 'Escolha de onde o fato veio.', field: 'source' };
  const note = parseNote(b.source_note);
  if (!note.ok) return note;
  return { ok: true, value: { kind, text: text.value, source: source as FactSource, source_note: note.value } };
}

export function parseFactPatch(body: unknown): Parsed<FactPatch> {
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
  if (Object.keys(patch).length === 1) return { ok: false, error: 'Nada para alterar.' };
  return { ok: true, value: patch };
}

export function factFromRow(row: Record<string, unknown>): CompanyFact {
  return {
    id: String(row.id),
    kind: row.kind as FactKind,
    text: String(row.text),
    source: row.source as FactSource,
    sourceNote: typeof row.source_note === 'string' ? row.source_note : null,
    active: row.active !== false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
  };
}

// O que o agente recebe: só o que está ativo, separado em "pode afirmar" e "nunca afirmar".
export function factsForPrompt(facts: readonly CompanyFact[]): { facts: string[]; never: string[] } {
  const active = facts.filter((f) => f.active);
  return { facts: active.filter((f) => f.kind === 'fact').map((f) => f.text), never: active.filter((f) => f.kind === 'never').map((f) => f.text) };
}
