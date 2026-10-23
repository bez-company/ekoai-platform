// edit-model.ts: o ajuste rápido do post (SPEC 019). Puro, sem I/O. O corpo que a tela manda é validado
// aqui, antes de qualquer leitura ou gravação: só os campos da lista fechada, cada um com o seu limite,
// e nenhum campo desconhecido passa. O servidor junta o que veio sobre o design guardado (o que não é
// editável, como a foto anexada, fica como estava).

import { isHex } from './color';
import { compatibleLayouts, isLayout, TEXT_COLOR_KEYS, type Layout, type LogoCorner, type PostKind, type StoredDesign, type TextColors, type Texts } from './model';

export const MAX_TEXT = 280;
export const MAX_ITEMS = 10;
export const LOGO_CORNERS: readonly LogoCorner[] = ['tl', 'tr', 'bl', 'br'];

// O que a pessoa pode ajustar. `sub`, `kicker` e `items` ausentes significam "sem": a remoção é uma edição.
export type EditableDesign = {
  layout: Layout;
  texts: Texts;
  logoCorner?: LogoCorner;
  logoHidden?: boolean;
  colors?: TextColors;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

const TOP_KEYS = new Set(['layout', 'texts', 'logoCorner', 'logoHidden', 'colors']);
const TEXT_KEYS = new Set(['kicker', 'title', 'sub', 'items']);

const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Quebra de linha vira espaço (o render quebra sozinho) e tira controle e espaço sobrando.
const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

function text(value: unknown, field: string, label: string): Parsed<string> {
  if (typeof value !== 'string') return fail(`${label} precisa ser um texto.`, field);
  const t = clean(value);
  if (!t) return fail(`${label} não pode ficar vazio.`, field);
  if (t.length > MAX_TEXT) return fail(`${label} passa de ${MAX_TEXT} caracteres. Encurte.`, field);
  return { ok: true, value: t };
}

function optionalText(value: unknown, field: string, label: string): Parsed<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  return text(value, field, label);
}

export function parseEditable(body: unknown): Parsed<EditableDesign> {
  if (!isObject(body)) return fail('Corpo inválido: mande o design com layout e texts.');
  for (const key of Object.keys(body)) if (!TOP_KEYS.has(key)) return fail(`O campo "${key}" não pode ser ajustado.`, key);

  if (!isLayout(body.layout)) return fail('Escolha um layout da lista.', 'layout');
  if (!isObject(body.texts)) return fail('Faltou o texto da imagem.', 'texts');
  for (const key of Object.keys(body.texts)) if (!TEXT_KEYS.has(key)) return fail(`O texto "${key}" não existe neste layout.`, `texts.${key}`);

  const title = text(body.texts.title, 'texts.title', 'O título');
  if (!title.ok) return title;
  const kicker = optionalText(body.texts.kicker, 'texts.kicker', 'O selo');
  if (!kicker.ok) return kicker;
  const sub = optionalText(body.texts.sub, 'texts.sub', 'O subtítulo');
  if (!sub.ok) return sub;

  let items: string[] | undefined;
  if (body.texts.items !== undefined && body.texts.items !== null) {
    if (!Array.isArray(body.texts.items)) return fail('Os itens precisam ser uma lista.', 'texts.items');
    if (body.texts.items.length > MAX_ITEMS) return fail(`A lista aceita até ${MAX_ITEMS} itens.`, 'texts.items');
    items = [];
    for (let i = 0; i < body.texts.items.length; i += 1) {
      const item = text(body.texts.items[i], `texts.items.${i}`, `O item ${i + 1}`);
      if (!item.ok) return item;
      items.push(item.value);
    }
    if (!items.length) items = undefined;
  }

  const value: EditableDesign = {
    layout: body.layout,
    texts: { title: title.value, ...(kicker.value ? { kicker: kicker.value } : {}), ...(sub.value ? { sub: sub.value } : {}), ...(items ? { items } : {}) },
  };

  if (body.logoCorner !== undefined && body.logoCorner !== null) {
    if (typeof body.logoCorner !== 'string' || !(LOGO_CORNERS as readonly string[]).includes(body.logoCorner)) return fail('Escolha um canto do logo da lista.', 'logoCorner');
    value.logoCorner = body.logoCorner as LogoCorner;
  }
  if (body.logoHidden !== undefined && body.logoHidden !== null) {
    if (typeof body.logoHidden !== 'boolean') return fail('Esconder o logo é sim ou não.', 'logoHidden');
    if (body.logoHidden) value.logoHidden = true;
  }
  if (body.colors !== undefined && body.colors !== null) {
    if (!isObject(body.colors)) return fail('As cores precisam ser um objeto.', 'colors');
    const colors: TextColors = {};
    for (const [key, raw] of Object.entries(body.colors)) {
      if (!(TEXT_COLOR_KEYS as readonly string[]).includes(key)) return fail(`A cor "${key}" não pode ser ajustada.`, `colors.${key}`);
      if (raw === null || raw === undefined) continue;
      if (!isHex(raw)) return fail('A cor precisa ser um hex no formato #RRGGBB.', `colors.${key}`);
      colors[key as keyof TextColors] = raw.toUpperCase();
    }
    if (Object.keys(colors).length) value.colors = colors;
  }
  return { ok: true, value };
}

// O layout escolhido precisa servir ao tipo do post e ao conteúdo (lista numerada pede 2 itens, foto pede visual).
export function checkLayout(value: EditableDesign, kind: PostKind, hasVisual: boolean, current?: Layout): Parsed<EditableDesign> {
  if (!compatibleLayouts(kind, value.texts, hasVisual, current).includes(value.layout)) {
    return fail('Este layout não serve a este post. Escolha um dos que aparecem na lista.', 'layout');
  }
  return { ok: true, value };
}

// O design guardado com o ajuste por cima. Chaves que a pessoa não edita (a foto anexada, por exemplo)
// continuam como estavam; as editáveis são trocadas por inteiro, e ausente significa "sem".
export function applyEditable(stored: StoredDesign, edit: EditableDesign): StoredDesign {
  const { logoCorner: _c, logoHidden: _h, colors: _col, texts: _t, layout: _l, ...rest } = stored as StoredDesign & Record<string, unknown>;
  return {
    ...rest,
    layout: edit.layout,
    texts: edit.texts,
    ...(edit.logoCorner ? { logoCorner: edit.logoCorner } : {}),
    ...(edit.logoHidden ? { logoHidden: true } : {}),
    ...(edit.colors ? { colors: edit.colors } : {}),
  } as StoredDesign;
}

// O que a tela recebe para preencher o painel: o design guardado, só com os campos editáveis.
export function editableOf(stored: StoredDesign): EditableDesign {
  return {
    layout: stored.layout,
    texts: stored.texts,
    ...(stored.logoCorner ? { logoCorner: stored.logoCorner } : {}),
    ...(stored.logoHidden ? { logoHidden: true } : {}),
    ...(stored.colors && Object.keys(stored.colors).length ? { colors: stored.colors } : {}),
  };
}

// ── O corpo das rotas ────────────────────────────────────────────────────────

const MAX_VERSION = 100_000;

export function parseVersion(value: unknown, label = 'A versão'): Parsed<number> {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_VERSION) return fail(`${label} é inválida. Recarregue a página.`, 'baseVersion');
  return { ok: true, value: n };
}

// Prévia e Confirmar: a versão de onde a pessoa partiu e o design editado. `editMs` (tempo da sessão de
// ajuste, só para medir) é opcional e limitado a 1 hora.
export function parseEditBody(body: unknown): Parsed<{ baseVersion: number; edit: EditableDesign; editMs: number | null }> {
  if (!isObject(body)) return fail('Corpo inválido: mande baseVersion e design.');
  const baseVersion = parseVersion(body.baseVersion);
  if (!baseVersion.ok) return baseVersion;
  const edit = parseEditable(body.design);
  if (!edit.ok) return edit;
  let editMs: number | null = null;
  if (body.editMs !== undefined && body.editMs !== null) {
    if (typeof body.editMs !== 'number' || !Number.isFinite(body.editMs) || body.editMs < 0) return fail('O tempo de edição é inválido.', 'editMs');
    editMs = Math.min(Math.round(body.editMs), 3_600_000);
  }
  return { ok: true, value: { baseVersion: baseVersion.value, edit: edit.value, editMs } };
}

export function parseRestoreBody(body: unknown): Parsed<{ baseVersion: number }> {
  if (!isObject(body)) return fail('Corpo inválido: mande baseVersion.');
  const baseVersion = parseVersion(body.baseVersion);
  return baseVersion.ok ? { ok: true, value: { baseVersion: baseVersion.value } } : baseVersion;
}
