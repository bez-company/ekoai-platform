// diff.ts: o que mudou entre duas versões do design de um post (SPEC 019, ADR 0021). Puro. O servidor
// calcula; a tela nunca manda diff. Só campos da lista fechada saem daqui, cada um com `antes`, `depois`
// e o contexto do post, e o resumo em português sai de template, nunca de modelo.

import { defaultCorner, TEXT_COLOR_KEYS, type Layout, type LogoCorner, type PostKind, type Ratio, type StoredDesign } from './model';

export type DiffScalar = string | boolean | null;
export type DiffOp = 'set' | 'add' | 'remove';
export type DiffContext = { kind: PostKind; layout: Layout; ratio: Ratio; goal: string | null };
export type DiffEntry = { field: string; op: DiffOp; before: DiffScalar; after: DiffScalar; context: DiffContext };

export const MAX_DIFF_TEXT = 280;
export const MAX_SUMMARY = 160;

const clip = (v: string | undefined | null): string | null => (v === undefined || v === null ? null : v.slice(0, MAX_DIFF_TEXT));

function entry(field: string, before: DiffScalar, after: DiffScalar, context: DiffContext): DiffEntry | null {
  if (before === after) return null;
  const op: DiffOp = before === null ? 'add' : after === null ? 'remove' : 'set';
  return { field, op, before, after, context };
}

// Um resumo curto e estável da cena: o diff guarda só o que mudou, nunca as camadas inteiras.
const sceneKey = (d: StoredDesign): string | null => {
  if (!d.scene) return null;
  const text = JSON.stringify(d.scene);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `camadas:${(h >>> 0).toString(16)}`;
};

const CORNER = (d: StoredDesign): LogoCorner => d.logoCorner ?? defaultCorner(d.layout);

export function diffDesigns(before: StoredDesign, after: StoredDesign, context: DiffContext): DiffEntry[] {
  const out: (DiffEntry | null)[] = [];
  const b = before.texts;
  const a = after.texts;
  out.push(entry('layout', before.layout, after.layout, context));
  out.push(entry('texts.kicker', clip(b.kicker), clip(a.kicker), context));
  out.push(entry('texts.title', clip(b.title), clip(a.title), context));
  out.push(entry('texts.sub', clip(b.sub), clip(a.sub), context));
  const n = Math.max(b.items?.length ?? 0, a.items?.length ?? 0);
  for (let i = 0; i < n; i += 1) out.push(entry(`texts.items.${i}`, clip(b.items?.[i]), clip(a.items?.[i]), context));
  // Canto sempre pelo valor efetivo: escolher o canto que já era o padrão não é mudança.
  out.push(entry('logoCorner', CORNER(before), CORNER(after), context));
  out.push(entry('logoHidden', !!before.logoHidden, !!after.logoHidden, context));
  out.push(entry('scene', sceneKey(before), sceneKey(after), context));
  for (const key of TEXT_COLOR_KEYS) out.push(entry(`colors.${key}`, before.colors?.[key] ?? null, after.colors?.[key] ?? null, context));
  return out.filter((e): e is DiffEntry => e !== null);
}

const CORNER_NAME: Record<LogoCorner, string> = { tl: 'superior esquerdo', tr: 'superior direito', bl: 'inferior esquerdo', br: 'inferior direito' };
const LAYOUT_NAME: Record<Layout, string> = {
  'lista-numerada': 'lista numerada',
  'titulo-destaque': 'título em destaque',
  'foto-titulo': 'foto com título',
  'foto-janela': 'foto na janela',
  'foto-arco': 'foto no arco',
  marca: 'cartão de marca',
  'lamina-item': 'lâmina de item',
};
const TEXT_NAME: Record<string, string> = { 'texts.kicker': 'selo', 'texts.title': 'título', 'texts.sub': 'subtítulo' };
const COLOR_NAME: Record<string, string> = { 'colors.title': 'do título', 'colors.sub': 'do subtítulo', 'colors.kicker': 'do selo', 'colors.items': 'dos itens' };

// Uma frase por campo. O gênero fica fixo por campo para a frase soar certa.
function phrase(e: DiffEntry): string {
  if (e.field === 'layout') return `layout trocado para ${LAYOUT_NAME[e.after as Layout] ?? 'outra família'}`;
  if (e.field === 'logoCorner') return `logo movido para o canto ${CORNER_NAME[e.after as LogoCorner] ?? 'novo'}`;
  if (e.field === 'scene') return e.after === null ? 'voltou ao layout automático' : 'imagem editada no Studio';
  if (e.field === 'logoHidden') return e.after ? 'logo escondido' : 'logo de volta';
  if (e.field.startsWith('colors.')) return e.op === 'remove' ? `cor ${COLOR_NAME[e.field]} voltou à da marca` : `cor ${COLOR_NAME[e.field]} alterada`;
  if (e.field.startsWith('texts.items.')) return e.op === 'remove' ? `item ${Number(e.field.split('.')[2]) + 1} removido` : e.op === 'add' ? `item ${Number(e.field.split('.')[2]) + 1} adicionado` : `item ${Number(e.field.split('.')[2]) + 1} alterado`;
  const name = TEXT_NAME[e.field] ?? 'texto';
  if (e.op === 'remove') return `${name} removido`;
  if (e.op === 'add') return `${name} adicionado`;
  return `${name} alterado`;
}

export function summarize(entries: readonly DiffEntry[]): string {
  if (!entries.length) return 'Sem mudança';
  const parts = entries.map(phrase);
  const text = parts.length === 1 ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : `${parts.length} ajustes: ${parts.join(', ')}`;
  return text.length <= MAX_SUMMARY ? text : `${parts.length} ajustes em ${new Set(entries.map((e) => e.field.split('.')[0])).size} partes do post`;
}
