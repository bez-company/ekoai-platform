// ideas.ts: aprovação por ideia (SPEC 003 R3/R6), lado servidor. Aprovar agenda cada rede
// ligada; rede desligada sai da fila sem virar anti-exemplo (não é conteúdo ruim, é escolha).
// Cada decisão vira um sinal em post_events, que o reflect usa como preferência.

import type { TenantDb } from './tenant-db';
import { approvePending, rejectPending } from './scheduling';
import { roleOf, type ApproveAllItem, type IdeaItem, type ReworkInput } from './ideas-model';
import { assertDesignVersion, markDesignApproved } from './post-design-revisions';
import type { PendingApproval, Variation } from './types';
import { composeCaption } from './caption';
import { UserError } from './errors';

// Pelo seed (sempre tem o brief_id), pra funcionar antes da migration 0009.
export async function getIdeaPendings(t: TenantDb, briefId: string): Promise<PendingApproval[]> {
  const { data, error } = await t.select('pending_approvals').eq('seed->>brief_id', briefId);
  if (error) throw new Error(`Falha ao ler a ideia: ${error.message}`);
  return (data || []) as PendingApproval[];
}

async function recordSignals(t: TenantDb, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await t.insert(
    'post_events',
    rows.map((payload) => ({ post_id: null, type: 'idea_decision', payload })),
  );
  if (error) console.error(`[ideas] sinais não gravados: ${error.message}`);
}

export async function approveIdea(
  t: TenantDb,
  briefId: string,
  items: IdeaItem[],
): Promise<{ scheduled: number; skipped: number }> {
  const pendings = await getIdeaPendings(t, briefId);
  const byId = new Map(pendings.map((p) => [p.pending_id, p]));
  const signals: Record<string, unknown>[] = [];
  let scheduled = 0;
  let skipped = 0;

  for (const item of items) {
    const p = byId.get(item.pendingId);
    if (!p) continue; // já resolvida em outra aba
    const variations: Variation[] = p.generation?.variations || [];
    const chosen = variations.find((v) => v.id === item.captionId);
    const base = {
      brief_id: briefId,
      channel: p.channel,
      role: roleOf(p),
      chosen_variation: item.captionId,
      top_variation: p.top_id ?? null,
    };
    if (!item.enabled) {
      await t.delete('pending_approvals').eq('pending_id', p.pending_id);
      signals.push({ ...base, enabled: false });
      skipped += 1;
      continue;
    }
    await approvePending(t, item);
    const edited = !!item.captionText && chosen ? item.captionText.trim() !== composeCaption(chosen).trim() : false;
    signals.push({ ...base, enabled: true, edited });
    scheduled += 1;
  }

  await recordSignals(t, signals);
  await t.update('briefs', { status: 'approved' }).eq('id', briefId);
  return { scheduled, skipped };
}

// Aprova de uma vez as redes ligadas de uma ideia (SPEC 028, BEZ-436). Legenda, arte e horário saem da própria pendência (o
// padrão de cada aba); a tela só manda o que mudou. Confere a versão do design antes de agendar qualquer rede, para não aprovar
// metade. Se uma rede falhar no meio, as já agendadas saem da fila e repetir a chamada aprova só o resto.
export async function approveAll(t: TenantDb, briefId: string, items: ApproveAllItem[]): Promise<{ scheduled: { pendingId: string; channel: string; id: string; scheduledFor: string | null }[]; skipped: number }> {
  const pendings = await getIdeaPendings(t, briefId);
  const byId = new Map(pendings.map((p) => [p.pending_id, p]));
  const open = items.filter((i) => byId.has(i.pendingId)); // as já resolvidas em outra aba ficam de fora
  if (!open.some((i) => i.enabled)) throw new UserError('Este post já foi aprovado ou recusado. Atualize a página.');

  const designs = new Map<string, Awaited<ReturnType<typeof assertDesignVersion>>>();
  for (const item of open.filter((i) => i.enabled)) designs.set(item.pendingId, await assertDesignVersion(t, item.pendingId, item.designVersion));

  const signals: Record<string, unknown>[] = [];
  const scheduled: { pendingId: string; channel: string; id: string; scheduledFor: string | null }[] = [];
  let skipped = 0;
  for (const item of open) {
    const p = byId.get(item.pendingId)!;
    const variations: Variation[] = p.generation?.variations || [];
    const images = p.images || [];
    const captionId = p.top_id ?? variations[0]?.id ?? 1;
    const base = { brief_id: briefId, channel: p.channel, role: roleOf(p), chosen_variation: captionId, top_variation: p.top_id ?? null };
    if (!item.enabled) {
      await t.delete('pending_approvals').eq('pending_id', p.pending_id);
      signals.push({ ...base, enabled: false });
      skipped += 1;
      continue;
    }
    // Texto puro (SPEC 005): padrão quando a variação é `text` ou não há arte; o Instagram exige imagem.
    const noImage = p.channel !== 'instagram' && (variations.find((v) => v.id === captionId)?.format === 'text' || !images.some((i) => i.url));
    const artId = images.find((i) => i.url)?.id ?? images[0]?.id ?? captionId;
    const result = await approvePending(t, { pendingId: p.pending_id, captionId, artId, captionText: item.captionText, noImage });
    const design = designs.get(item.pendingId);
    if (design) await markDesignApproved(t, design.designId);
    const chosen = variations.find((v) => v.id === captionId);
    signals.push({ ...base, enabled: true, edited: !!item.captionText && !!chosen && item.captionText.trim() !== composeCaption(chosen).trim() });
    scheduled.push({ pendingId: p.pending_id, channel: p.channel, id: result.id, scheduledFor: result.scheduledFor });
  }

  await recordSignals(t, signals);
  await t.update('briefs', { status: 'approved' }).eq('id', briefId);
  return { scheduled, skipped };
}

export async function rejectIdea(t: TenantDb, briefId: string, reason?: string): Promise<void> {
  const pendings = await getIdeaPendings(t, briefId);
  for (const p of pendings) await rejectPending(t, p.pending_id, reason);
  await recordSignals(t, [{ brief_id: briefId, rejected: true, reason: reason || null }]);
  await t.update('briefs', { status: 'dropped' }).eq('id', briefId);
}

// Pede ao resolve (cron) uma versão nova da rede: post próprio ou readaptação a partir
// de uma variação do conteúdo-mãe. A pendência atual fica visível até a nova chegar.
export async function requestRework(t: TenantDb, input: ReworkInput): Promise<void> {
  const { data, error } = await t.select('pending_approvals').eq('pending_id', input.pendingId).limit(1);
  if (error) throw new Error(`Falha ao ler pendência: ${error.message}`);
  const p = data?.[0] as PendingApproval | undefined;
  if (!p) throw new UserError('Pendência não encontrada (já resolvida?).');
  const seed: Record<string, unknown> = {
    ...(p.seed || {}),
    rework: { mode: input.mode, source_variation_id: input.sourceVariationId ?? null, requested_at: new Date().toISOString() },
  };
  const { error: ue } = await t
    .update('pending_approvals', { status: 'rework_requested', seed })
    .eq('pending_id', input.pendingId);
  if (ue) throw new Error(`Falha ao registrar o pedido: ${ue.message}`);
  await recordSignals(t, [{ brief_id: seed.brief_id ?? null, channel: p.channel, role: roleOf(p), rework: input.mode }]);
}
