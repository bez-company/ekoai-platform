// marks.ts: ligar e desligar a logo e o @ da marca no post do estúdio (BEZ-502). O estúdio já deixa o post pronto em todas as combinações que a
// peça permite (render do mesmo HTML sem os dois elementos, sem chamar modelo e sem custo); em Aprovar a pessoa só troca qual delas vale.

import type { TenantDb } from '../tenant-db';
import { ConflictError, NotFoundError } from '../errors';
import { isStudioDesign } from './is-studio';

export type Marks = { logo: boolean; handle: boolean };
export const markKey = (m: Marks): string => `${m.logo ? 1 : 0}${m.handle ? 1 : 0}`;
type StoredVariant = Marks & { pngKey: string };
type StoredMarks = { has: Marks; show: Marks; variants: StoredVariant[] };
type Row = Record<string, unknown>;

// O que a peça tem para desligar: o logo vem do marcador {{logo:...}} e o @ do atributo data-handle (o designer e os modelos prontos escrevem os dois).
export const marksIn = (html: string, hasLogoFile: boolean): Marks => ({ logo: hasLogoFile && /\{\{\s*logo:/.test(html), handle: /\sdata-handle[\s=>]/.test(html) || />\s*@[\w.]{2,}\s*</.test(html) });

// As combinações a renderizar além da peça inteira.
export function extraVariants(has: Marks): Marks[] {
  const all: Marks[] = [];
  for (const logo of has.logo ? [true, false] : [false]) for (const handle of has.handle ? [true, false] : [false]) all.push({ logo, handle });
  return all.filter((m) => !(m.logo === has.logo && m.handle === has.handle));
}

// O post do estúdio sem o @ da marca é refugado pelo portão quando a conta tem @: o designer põe o @ num elemento data-handle ou refaz.
export const handleProblem = (html: string, handle: string | null): string | null => (handle && !/\sdata-handle[\s=>]/.test(html) ? 'falta o @ da marca num elemento com data-handle' : null);

export async function chooseStudioMarks(t: TenantDb, pendingId: string, want: Marks): Promise<{ show: Marks; url: string }> {
  const pend = await t.select('pending_approvals', 'pending_id,status,post_design_id,images,generation,archived_at').eq('pending_id', pendingId).maybeSingle();
  if (pend.error) throw new Error(`pendências: ${pend.error.message}`);
  const p = pend.data as Row | null;
  if (!p || !p.post_design_id) throw new NotFoundError('Post não encontrado. Recarregue a página.');
  if (p.status !== 'awaiting_decision' || p.archived_at) throw new ConflictError('Este post já foi decidido. Logo e @ só mudam antes de aprovar.');
  const d = await t.select('post_designs', 'id,design').eq('id', p.post_design_id as string).maybeSingle();
  if (d.error) throw new Error(`post_designs: ${d.error.message}`);
  const design = (d.data as Row | null)?.design as { studio?: { marks?: StoredMarks } } | undefined;
  const marks = design?.studio?.marks;
  if (!d.data || !isStudioDesign(design) || !marks) throw new ConflictError('Este post não tem logo nem @ para ligar ou desligar.');
  const show = { logo: marks.has.logo ? want.logo : false, handle: marks.has.handle ? want.handle : false };
  const chosen = marks.variants.find((v) => markKey(v) === markKey(show));
  if (!chosen) throw new ConflictError('Essa combinação não existe neste post. Recarregue a página.');
  const generation = (p.generation ?? {}) as { studio?: { marks?: { urls?: Record<string, string> } } };
  const url = generation.studio?.marks?.urls?.[markKey(show)];
  if (!url) throw new ConflictError('Essa combinação não tem imagem. Recarregue a página.');

  const upd = await t.update('post_designs', { png_key: chosen.pngKey, design: { ...(design as object), studio: { ...design!.studio, marks: { ...marks, show } } } }).eq('id', d.data.id as string);
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
  const images = [{ id: 1, url, path: chosen.pngKey }];
  const upp = await t.update('pending_approvals', { images, generation: { ...generation, studio: { ...generation.studio, marks: { ...generation.studio!.marks, show } } } }).eq('pending_id', pendingId);
  if (upp.error) throw new Error(`pendências: ${upp.error.message}`);
  return { show, url };
}
