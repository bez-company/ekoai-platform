// design-edit-view.ts: a lógica da tela de ajuste rápido que não depende do navegador (SPEC 019, BEZ-268).
// Puro e seguro para o cliente: não importa o motor de render (que lê fontes do disco). Desfazer e refazer da
// sessão, o resumo do que mudou antes de confirmar e o selo de contraste. O servidor continua sendo quem
// decide: a prévia, o revisor e o Confirmar valem mais que qualquer conta daqui.

import type { EditableDesign } from './design/edit-model';

export type { EditableDesign };

const CORNER_NAME: Record<string, string> = { tl: 'superior esquerdo', tr: 'superior direito', bl: 'inferior esquerdo', br: 'inferior direito' };
export const LAYOUT_LABEL: Record<string, { name: string; hint: string }> = {
  'lista-numerada': { name: 'Lista numerada', hint: 'Fundo claro, itens numerados' },
  'titulo-destaque': { name: 'Título em destaque', hint: 'Fundo da marca, título grande' },
  'foto-titulo': { name: 'Foto com título', hint: 'A foto de fundo e o título por cima' },
  'foto-janela': { name: 'Foto na janela', hint: 'A foto numa janela, texto na cor da marca' },
  'foto-arco': { name: 'Foto no arco', hint: 'A foto num arco, texto na cor da marca' },
  marca: { name: 'Cartão de marca', hint: 'Fundo liso, logo, nome e frase onde você pediu' },
  'lamina-item': { name: 'Lâmina de item', hint: 'Fundo claro, número do item e título grande' },
};

// O canto padrão de cada família (o mesmo de design/model.ts: um teste confere os dois).
export const defaultCornerOf = (layout: string): string => (layout === 'foto-titulo' ? 'br' : 'bl');
export const cornerOf = (d: EditableDesign): string => d.logoCorner ?? defaultCornerOf(d.layout);

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
export const sameDesign = (a: EditableDesign, b: EditableDesign): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// O que mudou entre a versão em uso e a edição na tela, em português, antes de confirmar.
export function changesOf(base: EditableDesign, cur: EditableDesign): string[] {
  const out: string[] = [];
  if (cur.layout !== base.layout) out.push(`layout trocado para ${(LAYOUT_LABEL[cur.layout]?.name ?? 'outro').toLowerCase()}`);
  if (cur.texts.title !== base.texts.title) out.push('título alterado');
  if (base.texts.sub && !cur.texts.sub) out.push('subtítulo removido');
  else if (cur.texts.sub !== base.texts.sub) out.push(base.texts.sub ? 'subtítulo alterado' : 'subtítulo adicionado');
  if (base.texts.kicker !== cur.texts.kicker) out.push(cur.texts.kicker ? 'selo alterado' : 'selo removido');
  if (JSON.stringify(base.texts.items ?? []) !== JSON.stringify(cur.texts.items ?? [])) out.push('itens alterados');
  if (cornerOf(base) !== cornerOf(cur)) out.push(`logo movido para o canto ${CORNER_NAME[cornerOf(cur)] ?? 'novo'}`);
  if (!!base.logoHidden !== !!cur.logoHidden) out.push(cur.logoHidden ? 'logo escondido' : 'logo de volta');
  if ((base.colors?.title ?? null) !== (cur.colors?.title ?? null)) out.push(cur.colors?.title ? 'cor do título alterada' : 'cor do título voltou à da marca');
  return out;
}

export const summaryOf = (changes: readonly string[]): string => (changes.length === 1 ? changes[0].charAt(0).toUpperCase() + changes[0].slice(1) : `${changes.length} ajustes: ${changes.join(', ')}`);

// Desfazer e refazer da sessão: nada vai ao banco até o Confirmar.
export type History = { past: EditableDesign[]; present: EditableDesign; future: EditableDesign[] };
export const startHistory = (present: EditableDesign): History => ({ past: [], present, future: [] });
export const edit = (h: History, next: EditableDesign): History => (sameDesign(h.present, next) ? h : { past: [...h.past, h.present], present: next, future: [] });
export const undo = (h: History): History => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
export const redo = (h: History): History => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);
// Restaurar padrão: volta à versão em uso, e o que foi feito ainda pode ser desfeito.
export const resetTo = (h: History, base: EditableDesign): History => edit(h, base);

// O selo de contraste do título: 4,5:1 para texto comum; 3:1 só vale para título grande em negrito.
export function contrastTone(ratio: number | undefined): { label: 'Bom' | 'No limite' | 'Baixo'; tone: 'success' | 'warning' | 'danger' } | null {
  if (ratio === undefined || !Number.isFinite(ratio)) return null;
  if (ratio >= 4.5) return { label: 'Bom', tone: 'success' };
  if (ratio >= 3) return { label: 'No limite', tone: 'warning' };
  return { label: 'Baixo', tone: 'danger' };
}
export const fmtRatio = (ratio: number): string => ratio.toFixed(1).replace('.', ',');

// Edições da tela, sempre devolvendo o design inteiro (o parser do servidor recebe o design completo).
export const withTitle = (d: EditableDesign, title: string): EditableDesign => ({ ...d, texts: { ...d.texts, title } });
export function withSub(d: EditableDesign, sub: string | null): EditableDesign {
  const { sub: _old, ...rest } = d.texts;
  return { ...d, texts: sub ? { ...rest, sub } : rest };
}
export const withCorner = (d: EditableDesign, corner: 'tl' | 'tr' | 'bl' | 'br'): EditableDesign => ({ ...d, logoCorner: corner, logoHidden: undefined });
export const withHidden = (d: EditableDesign, hidden: boolean): EditableDesign => ({ ...d, logoHidden: hidden ? true : undefined });
export function withTitleColor(d: EditableDesign, hex: string | null): EditableDesign {
  const { title: _old, ...rest } = d.colors ?? {};
  const colors = hex ? { ...rest, title: hex } : rest;
  return { ...d, colors: Object.keys(colors).length ? colors : undefined };
}
export const withLayout = (d: EditableDesign, layout: EditableDesign['layout']): EditableDesign => ({ ...d, layout });
