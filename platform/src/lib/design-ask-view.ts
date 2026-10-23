// design-ask-view.ts: o que a tela de "Pedir ajuste" (SPEC 024, BEZ-193) e o servidor compartilham. Puro e seguro
// para o cliente: sem import do motor de render. Os aspectos que a pessoa pode escolher, o limite do pedido, o
// formato da resposta da rota e as linhas do "o que mudou" em português.

import type { DiffEntry } from './design/diff';

export const ASPECTS = ['text', 'caption', 'layout', 'visual'] as const;
export type Aspect = (typeof ASPECTS)[number];
export const ASPECT_LABEL: Record<Aspect, string> = { text: 'Texto da imagem', layout: 'Layout', caption: 'Legenda', visual: 'Visual' };
export const MAX_INSTRUCTION = 500;

export type AskResponse = {
  version: number | null; // a versão nova do design; null quando só a legenda mudou
  previousVersion: number;
  summary: string | null;
  diff: Pick<DiffEntry, 'field' | 'op' | 'before' | 'after'>[];
  caption: { caption: string; hashtags: string[] } | null;
  needsVisual: boolean;
  notApplied: { what: string; why: string }[];
};

const CORNER: Record<string, string> = { tl: 'canto superior esquerdo', tr: 'canto superior direito', bl: 'canto inferior esquerdo', br: 'canto inferior direito' };
const LAYOUT: Record<string, string> = { 'lista-numerada': 'Lista numerada', 'titulo-destaque': 'Título em destaque', 'foto-titulo': 'Foto com título', 'foto-janela': 'Foto na janela', 'foto-arco': 'Foto no arco' };
const NAME: Record<string, string> = { 'texts.kicker': 'Selo', 'texts.title': 'Título', 'texts.sub': 'Subtítulo', logoCorner: 'Logo', logoHidden: 'Logo', layout: 'Layout' };
const COLOR: Record<string, string> = { 'colors.title': 'Cor do título', 'colors.sub': 'Cor do subtítulo', 'colors.kicker': 'Cor do selo', 'colors.items': 'Cor dos itens' };

export type ChangeRow = { label: string; before: string; after: string };

const shown = (v: string | boolean | null, field: string): string => {
  if (v === null) return 'removido';
  if (field === 'logoCorner') return CORNER[String(v)] ?? String(v);
  if (field === 'logoHidden') return v ? 'escondido' : 'visível';
  if (field === 'layout') return LAYOUT[String(v)] ?? String(v);
  if (field.startsWith('colors.')) return String(v);
  return `"${String(v)}"`;
};

// Uma linha por campo que mudou, na ordem do diff; os itens da lista viram "Item N". A legenda entra à parte.
export function changeRows(diff: readonly Pick<DiffEntry, 'field' | 'before' | 'after'>[], captionChanged: boolean): ChangeRow[] {
  const rows = diff.map((e): ChangeRow => {
    const item = e.field.startsWith('texts.items.') ? `Item ${Number(e.field.split('.')[2]) + 1}` : null;
    const label = item ?? NAME[e.field] ?? COLOR[e.field] ?? 'Texto';
    return { label, before: e.field.startsWith('colors.') && e.before === null ? 'cor da marca' : shown(e.before, e.field), after: e.field.startsWith('colors.') && e.after === null ? 'cor da marca' : shown(e.after, e.field) };
  });
  if (captionChanged) rows.push({ label: 'Legenda', before: 'anterior', after: 'ajustada' });
  return rows;
}
