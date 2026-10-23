// ask-model.ts: pedir ajuste em texto livre (SPEC 024, BEZ-193). Puro, sem I/O. O corpo da rota e a resposta do
// modelo entram aqui antes de qualquer gravação. O contrato com o modelo é fechado (ADR 0022): só as chaves da
// lista passam, o resto é descartado, e o que o modelo devolve é um PATCH. Quem junta o patch ao design é o
// código, então o que o pedido não citou fica idêntico por construção, e o design resultante passa pelo mesmo
// parser do ajuste rápido (parseEditable) e pelo mesmo revisor do Confirmar.

import { cleanHashtags, LIMITS } from '../agents';
import { ASPECTS, MAX_INSTRUCTION, type Aspect } from '../design-ask-view';
import { parseEditable, parseVersion, type EditableDesign, type Parsed } from './edit-model';
import { TEXT_COLOR_KEYS, type Layout } from './model';

const MAX_CAPTION = LIMITS.caption;
const MAX_NOT_APPLIED = 5;

const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ── O corpo da rota ──────────────────────────────────────────────────────────

export type AskInput = { baseVersion: number; instruction: string; aspect: Aspect | null; caption: string; hashtags: string[] };

export function parseAskBody(body: unknown): Parsed<AskInput> {
  if (!isObject(body)) return fail('Corpo inválido: mande baseVersion e instruction.');
  const baseVersion = parseVersion(body.baseVersion);
  if (!baseVersion.ok) return baseVersion;
  if (typeof body.instruction !== 'string') return fail('Escreva o que você quer mudar no post.', 'instruction');
  const instruction = clean(body.instruction);
  if (!instruction) return fail('Escreva o que você quer mudar no post.', 'instruction');
  if (instruction.length > MAX_INSTRUCTION) return fail(`O pedido passa de ${MAX_INSTRUCTION} caracteres. Encurte.`, 'instruction');
  let aspect: Aspect | null = null;
  if (body.aspect !== undefined && body.aspect !== null) {
    if (typeof body.aspect !== 'string' || !(ASPECTS as readonly string[]).includes(body.aspect)) return fail('Escolha onde mudar: texto, layout, legenda ou visual.', 'aspect');
    aspect = body.aspect as Aspect;
  }
  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, MAX_CAPTION) : '';
  const hashtags = cleanHashtags(body.hashtags);
  return { ok: true, value: { baseVersion: baseVersion.value, instruction, aspect, caption, hashtags } };
}

// ── A resposta do modelo ─────────────────────────────────────────────────────

export type NotApplied = { what: string; why: string };
export type CaptionPatch = { caption: string; hashtags: string[] };
export type AskOutcome = {
  edit: EditableDesign | null; // o design inteiro a gravar; null = a imagem fica como está
  caption: CaptionPatch | null; // a legenda proposta; null = a legenda fica como está
  needsVisual: boolean; // o pedido quer um visual novo: não há o que aplicar sem gerar de novo
  notApplied: NotApplied[];
};

const IMAGE_KEYS = new Set(['layout', 'texts', 'logoCorner', 'logoHidden', 'colors']);
const TEXT_KEYS = ['kicker', 'title', 'sub', 'items'] as const;

// O design atual com o patch por cima. Só as chaves da lista entram; `null` tira selo, subtítulo, itens e cor.
function mergeImage(current: EditableDesign, patch: Record<string, unknown>): Record<string, unknown> {
  const texts: Record<string, unknown> = { ...current.texts };
  const colors: Record<string, unknown> = { ...(current.colors ?? {}) };
  // Parte de uma cópia do design inteiro: um campo editável que ganhe a lista (SPEC 020, posições) não se perde aqui.
  const out: Record<string, unknown> = { ...current, texts };
  delete out.colors;
  for (const key of Object.keys(patch)) {
    if (!IMAGE_KEYS.has(key)) continue;
    const value = patch[key];
    if (key === 'texts' && isObject(value)) {
      for (const k of TEXT_KEYS) {
        if (!(k in value)) continue;
        if (value[k] === null) delete texts[k];
        else texts[k] = value[k];
      }
    } else if (key === 'colors' && isObject(value)) {
      for (const k of TEXT_COLOR_KEYS) {
        if (!(k in value)) continue;
        if (value[k] === null) delete colors[k];
        else colors[k] = value[k];
      }
    } else if (key === 'layout' || key === 'logoCorner' || key === 'logoHidden') {
      if (value !== null && value !== undefined) out[key] = value;
    }
  }
  if (Object.keys(colors).length) out.colors = colors;
  return out;
}

function notAppliedOf(raw: unknown): NotApplied[] {
  if (!Array.isArray(raw)) return [];
  const out: NotApplied[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.what !== 'string' || typeof item.why !== 'string') continue;
    const what = clean(item.what).slice(0, 80);
    const why = clean(item.why).slice(0, 240);
    if (what && why) out.push({ what, why });
    if (out.length >= MAX_NOT_APPLIED) break;
  }
  return out;
}

// Nunca lança: resposta fora do contrato vira "não apliquei", com o motivo na tela.
export function parseAskResult(json: unknown, current: EditableDesign, layouts: readonly Layout[], currentCaption: CaptionPatch): AskOutcome {
  const result: AskOutcome = { edit: null, caption: null, needsVisual: false, notApplied: [] };
  if (!isObject(json)) {
    result.notApplied.push({ what: 'Pedido', why: 'A Ekoai não entendeu o pedido. Escreva de outro jeito, dizendo o que mudar.' });
    return result;
  }
  result.needsVisual = json.needsVisual === true;
  result.notApplied = notAppliedOf(json.notApplied);

  if (isObject(json.image)) {
    const patch = { ...json.image };
    if (patch.layout !== undefined && patch.layout !== null && !(layouts as readonly unknown[]).includes(patch.layout)) {
      result.notApplied.push({ what: 'Layout', why: 'Este layout não serve a este post. Escolha um dos que aparecem em "Trocar layout".' });
      delete patch.layout;
    }
    const merged = parseEditable(mergeImage(current, patch));
    if (!merged.ok) result.notApplied.push({ what: 'Imagem', why: merged.error });
    else if (!same(merged.value, current)) result.edit = merged.value;
  }

  if (isObject(json.caption)) {
    const caption = typeof json.caption.caption === 'string' ? json.caption.caption.trim().slice(0, MAX_CAPTION) : currentCaption.caption;
    const hashtags = json.caption.hashtags === undefined ? currentCaption.hashtags : cleanHashtags(json.caption.hashtags);
    if (caption && !same({ caption, hashtags }, currentCaption)) result.caption = { caption, hashtags };
  }
  return result;
}
