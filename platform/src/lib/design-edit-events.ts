// design-edit-events.ts: as propriedades dos eventos do ajuste rápido (SPEC 019, BEZ-269). Puro. Só número,
// enum, o id do pedido e nomes curtos de campo: nunca o texto do post, nem o antes e depois do diff.
// Os números do Gate 4 saem daqui: ajuste por post, aprovação sem edição, custo e tempo de corrigir.

import type { DiffEntry } from './design/diff';
import type { RevisionSource } from './post-design-revisions';

export const WISHES = ['move', 'resize', 'other'] as const;
export type Wish = (typeof WISHES)[number];
export type EventProps = Record<string, string | number | boolean | null>;

// O nome curto do campo do diff: `texts.items.2` e `texts.title` viram `items` e `title`; as cores, `color`.
const LABEL = (field: string): string => (field.startsWith('texts.items') ? 'items' : field.startsWith('texts.') ? field.slice(6) : field.startsWith('colors.') ? 'color' : field);

export function fieldKeys(diff: readonly Pick<DiffEntry, 'field'>[]): string {
  return [...new Set(diff.map((d) => LABEL(d.field)))].join(',');
}

export function revisionSavedProps(input: { briefId: string; version: number; source: RevisionSource; diff: readonly Pick<DiffEntry, 'field'>[]; renderMs: number; editMs: number | null }): EventProps {
  return {
    brief_id: input.briefId,
    version: input.version,
    source: input.source,
    fields_changed: input.diff.length,
    field_keys: fieldKeys(input.diff),
    render_ms: Math.max(0, Math.round(input.renderMs)),
    // Corrigir um detalhe não chama modelo: é a metade "custo de modelo zero" do Gate 4.
    model_calls: 0,
    ...(input.editMs !== null ? { edit_ms: Math.min(Math.max(0, Math.round(input.editMs)), 3_600_000) } : {}),
  };
}

export const revisionRestoredProps = (input: { briefId: string; fromVersion: number; toVersion: number }): EventProps => ({
  brief_id: input.briefId,
  from_version: input.fromVersion,
  to_version: input.toVersion,
});

export type Signal = { kind: 'discarded'; edits: number } | { kind: 'wish'; wish: Wish };

// O sinal que só a tela sabe: a pessoa saiu sem confirmar, ou pediu mais controle (mover, redimensionar).
export function parseSignal(body: unknown): { ok: true; value: Signal } | { ok: false; error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (b.kind === 'discarded') {
    const edits = b.edits;
    if (typeof edits !== 'number' || !Number.isInteger(edits) || edits < 0 || edits > 1000) return { ok: false, error: 'Número de mudanças inválido.' };
    return { ok: true, value: { kind: 'discarded', edits } };
  }
  if (b.kind === 'wish') {
    if (typeof b.wish !== 'string' || !(WISHES as readonly string[]).includes(b.wish)) return { ok: false, error: 'Escolha o que faltou: mover, redimensionar ou outro.' };
    return { ok: true, value: { kind: 'wish', wish: b.wish as Wish } };
  }
  return { ok: false, error: 'Sinal desconhecido.' };
}

export function signalEvent(briefId: string, s: Signal): { event: 'design_edit_discarded' | 'design_edit_wish'; props: EventProps } {
  return s.kind === 'discarded'
    ? { event: 'design_edit_discarded', props: { brief_id: briefId, edits: s.edits } }
    : { event: 'design_edit_wish', props: { brief_id: briefId, wish: s.wish } };
}

// Aprovação: a versão que foi aprovada e se alguém editou (versão acima de 1). É a base de "aprovação sem edição".
export const approvedProps = (v: { briefId: string | null; version: number } | null): EventProps => (v ? { ...(v.briefId ? { brief_id: v.briefId } : {}), design_version: v.version, edited: v.version > 1 } : {});
