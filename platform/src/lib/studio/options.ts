// options.ts: escolher, em Aprovar, uma das opções de design que o estúdio entregou (SPEC 030, F4). O Autoral guarda até 3 peças do mesmo texto; trocar
// só aponta a pendência para outra delas (sem gerar de novo, sem custo). A escolhida vira a imagem do post, a que se aprova e se publica.

import type { TenantDb } from '../tenant-db';
import { ConflictError, NotFoundError } from '../errors';
import { isStudioDesign } from './is-studio';

type StoredOption = { pngKey: string; htmlKey: string; score: number | null };
type Row = Record<string, unknown>;

export async function chooseStudioOption(t: TenantDb, pendingId: string, index: number): Promise<{ selected: number; url: string }> {
  const pend = await t.select('pending_approvals', 'pending_id,status,post_design_id,images,generation,archived_at').eq('pending_id', pendingId).maybeSingle();
  if (pend.error) throw new Error(`pendências: ${pend.error.message}`);
  const p = pend.data as Row | null;
  if (!p || !p.post_design_id) throw new NotFoundError('Post não encontrado. Recarregue a página.');
  if (p.status !== 'awaiting_decision' || p.archived_at) throw new ConflictError('Este post já foi decidido. A escolha da opção só vale antes de aprovar.');
  const d = await t.select('post_designs', 'id,design').eq('id', p.post_design_id as string).maybeSingle();
  if (d.error) throw new Error(`post_designs: ${d.error.message}`);
  const design = (d.data as Row | null)?.design as { studio?: { options?: StoredOption[]; selected?: number } } | undefined;
  if (!d.data || !isStudioDesign(design)) throw new ConflictError('Este post não tem opções de design para escolher.');
  const options = design?.studio?.options ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= options.length) throw new ConflictError('Essa opção não existe. Recarregue a página.');
  const generation = (p.generation ?? {}) as { studio?: { options?: { url: string }[] } };
  const url = generation.studio?.options?.[index]?.url;
  if (!url) throw new ConflictError('Essa opção não tem imagem. Recarregue a página.');
  const chosen = options[index];

  const upd = await t.update('post_designs', { png_key: chosen.pngKey, design: { ...(design as object), studio: { ...design!.studio, htmlKey: chosen.htmlKey, selected: index } } }).eq('id', d.data.id as string);
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
  const images = [{ id: 1, url, path: chosen.pngKey }];
  const upp = await t.update('pending_approvals', { images, generation: { ...generation, studio: { ...generation.studio, selected: index } } }).eq('pending_id', pendingId);
  if (upp.error) throw new Error(`pendências: ${upp.error.message}`);
  return { selected: index, url };
}
