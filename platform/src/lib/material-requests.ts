// material-requests.ts: ler, criar e responder os pedidos de material (SPEC 036, BEZ-549). Tudo pelo tenantDb: o tenant
// vem da sessão ou da rodada do coordenador. A regra de quando pedir mora em material-request-model.ts; aqui ficam o
// banco, o aviso e o evento. A resposta vai para onde já existe: a foto para o banco de imagens (e para a sugestão), a
// confirmação para o fato, pelas mesmas funções da tela de fatos. A auditoria e o evento nunca levam o texto do pedido.

import { track } from './analytics';
import { auditTenant } from './audit';
import { confirmFact, listFacts, updateFact } from './company-facts';
import { parseFactPatch, todayLocal } from './company-facts-model';
import { UserError } from './errors';
import { log } from './log';
import { getMediaAsset, updateMediaAsset } from './media-assets';
import { canUseInPost, isSuggestable, type MediaAsset } from './media-asset-model';
import { materialAsk, needsReminder, requestFromRow, PAUSE_DAYS, type ConfirmAnswer, type MaterialRequest, type PlanSuggestion } from './material-request-model';
import { notify } from './notifications';
import { isPostGoal } from './post-goals';
import type { SessionUser } from './accounts';
import type { TenantDb } from './tenant-db';

const COLUMNS = 'id,kind,status,need_tag,fact_id,campaign_id,suggestion_id,title,reason,due_at,reminded_at,answered_at,outcome,created_at';
const DAY = 86_400_000;
const PLAN_AHEAD_DAYS = 8;
const GONE = 'Este pedido já foi respondido ou venceu. Recarregue a página.';

const link = (r: Pick<MaterialRequest, 'id'>) => `/pedidos/${r.id}`;

// Os pedidos que o Início mostra: abertos e no prazo, o que vence primeiro no topo.
export async function listOpenRequests(t: TenantDb, now: Date = new Date()): Promise<MaterialRequest[]> {
  const { data, error } = await t.select('material_requests', COLUMNS).eq('status', 'open').gt('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(10);
  if (error) throw new Error(`pedidos de material: ${error.message}`);
  return (data ?? []).map(requestFromRow);
}

// Os pedidos de uma campanha, para o detalhe dela: todos, do mais novo para o mais antigo.
export async function listCampaignRequests(t: TenantDb, campaignId: string): Promise<MaterialRequest[]> {
  const { data, error } = await t.select('material_requests', COLUMNS).eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(`pedidos de material: ${error.message}`);
  return (data ?? []).map(requestFromRow);
}

export async function getRequest(t: TenantDb, id: string): Promise<MaterialRequest | null> {
  const { data, error } = await t.select('material_requests', COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`pedidos de material: ${error.message}`);
  return data ? requestFromRow(data) : null;
}

// ── Rodada do coordenador ──────────────────────────────────────────────────────────────────────────

// Vencidos saem do Início com o resultado `expired` (sem culpa na tela). Lembrete: um, 24 h antes de vencer.
async function sweep(t: TenantDb, now: Date): Promise<void> {
  const iso = now.toISOString();
  const expired = await t.update('material_requests', { status: 'expired', outcome: 'expired', answered_at: iso }).eq('status', 'open').lte('due_at', iso).select('id,kind');
  if (expired.error) throw new Error(`pedidos de material: ${expired.error.message}`);
  for (const r of expired.data ?? []) await track(t.tenantId, 'material_answered', { kind: String(r.kind), outcome: 'expired' });

  for (const r of await listOpenRequests(t, now)) {
    if (!needsReminder(r, now)) continue;
    const mark = await t.update('material_requests', { reminded_at: iso }).eq('id', r.id).is('reminded_at', null).select('id');
    if (mark.error || !mark.data?.length) continue;
    await notify(t, { kind: 'material.reminder', level: 'warning', title: `Vence amanhã: ${r.title}`, body: 'Sem resposta até o horário do post, ele sai sem o material.', link: link(r), audience: 'team' });
  }
}

// Depois que o coordenador grava as sugestões: vence e lembra os abertos e, se a regra mandar, cria UM pedido novo.
// `assets` = o banco de imagens que a rodada já leu. Falha aqui não derruba a rodada (quem chama registra no log).
export async function askAfterPlanning(t: TenantDb, assets: readonly MediaAsset[], now: Date = new Date()): Promise<MaterialRequest | null> {
  await sweep(t, now);

  const since = new Date(now.getTime() - PAUSE_DAYS * DAY).toISOString();
  const past = await t.select('material_requests', 'kind,status,need_tag,fact_id,created_at,answered_at').or(`status.eq.open,created_at.gte.${since}`);
  if (past.error) throw new Error(`pedidos de material: ${past.error.message}`);
  const sugg = await t
    .select('content_suggestions', 'id,slot_at,goal,idea,asset_id,campaign_id')
    .eq('status', 'suggested')
    .gt('slot_at', now.toISOString())
    .lte('slot_at', new Date(now.getTime() + PLAN_AHEAD_DAYS * DAY).toISOString());
  if (sugg.error) throw new Error(`sugestões: ${sugg.error.message}`);

  const suggestions: PlanSuggestion[] = (sugg.data ?? [])
    .filter((s) => isPostGoal(s.goal))
    .map((s) => ({ id: String(s.id), slotAt: new Date(s.slot_at as string).toISOString(), goal: s.goal as PlanSuggestion['goal'], idea: String(s.idea), assetId: (s.asset_id as string | null) ?? null, campaignId: (s.campaign_id as string | null) ?? null }));
  const ask = materialAsk({
    now,
    today: todayLocal(now),
    suggestions,
    photos: assets.map((a) => ({ tags: a.tags, suggestable: isSuggestable(a, now) })),
    facts: await listFacts(t),
    past: (past.data ?? []).map((p) => ({
      kind: p.kind as MaterialRequest['kind'],
      status: p.status as MaterialRequest['status'],
      needTag: (p.need_tag as MaterialRequest['needTag']) ?? null,
      factId: (p.fact_id as string | null) ?? null,
      createdAt: new Date(p.created_at as string).toISOString(),
      answeredAt: p.answered_at ? new Date(p.answered_at as string).toISOString() : null,
    })),
  });
  if (!ask) return null;

  // Dois abertos já? A regra viu a lista de agora; a contagem aqui fecha a corrida entre duas rodadas.
  const open = await t.select('material_requests', 'id', { count: 'exact', head: true }).eq('status', 'open');
  if (open.error) throw new Error(`pedidos de material: ${open.error.message}`);
  if ((open.count ?? 0) >= 2) return null;

  const ins = await t
    .insert('material_requests', { kind: ask.kind, need_tag: ask.needTag, fact_id: ask.factId, campaign_id: ask.campaignId, suggestion_id: ask.suggestionId, title: ask.title, reason: ask.reason, due_at: ask.dueAt })
    .select(COLUMNS)
    .single();
  // Outra rodada pediu a mesma coisa primeiro (índice do pedido aberto): segue sem pedido novo.
  if (ins.error?.code === '23505') return null;
  if (ins.error) throw new Error(`pedidos de material: ${ins.error.message}`);
  const req = requestFromRow(ins.data!);
  await notify(t, { kind: 'material.requested', title: `A Ekoai precisa de você: ${req.title}`, body: req.reason, link: link(req), audience: 'team' });
  await track(t.tenantId, 'material_requested', { kind: req.kind, campaign: !!req.campaignId });
  log('info', 'material-requests', 'pedido de material criado', { tenant: t.tenantId, kind: req.kind });
  return req;
}

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────────

async function openRequest(t: TenantDb, id: string, kind: MaterialRequest['kind'], now: Date): Promise<MaterialRequest> {
  const req = await getRequest(t, id);
  if (!req || req.kind !== kind) throw new UserError('Pedido não encontrado. Recarregue a página.');
  if (req.status !== 'open' || Date.parse(req.dueAt) <= now.getTime()) throw new UserError(GONE);
  return req;
}

// Fecha o pedido só se ainda está aberto: duas respostas ao mesmo tempo, uma passa.
async function close(t: TenantDb, actor: SessionUser, req: MaterialRequest, values: Record<string, unknown>, now: Date): Promise<void> {
  const { data, error } = await t.update('material_requests', { ...values, answered_at: now.toISOString(), answered_by: actor.id }).eq('id', req.id).eq('status', 'open').select('id');
  if (error) throw new Error(`pedidos de material: ${error.message}`);
  if (!data?.length) throw new UserError(GONE);
  const outcome = String(values.outcome);
  await auditTenant(t, { actorUserId: actor.id, action: 'material.answered', targetType: 'material_request', targetId: req.id, metadata: { kind: req.kind, outcome } });
  await track(t.tenantId, 'material_answered', { kind: req.kind, outcome, wait_ms: Math.max(0, now.getTime() - Date.parse(req.createdAt)) });
}

// A foto (enviada pelo banco de imagens ou escolhida nele) responde o pedido: ganha a etiqueta pedida e entra na sugestão
// ligada, se a sugestão ainda está aberta e a foto pode entrar em post (pessoas só com autorização de uso de imagem).
export async function answerPhoto(t: TenantDb, actor: SessionUser, id: string, assetId: string, now: Date = new Date()): Promise<{ usedInPost: boolean }> {
  const req = await openRequest(t, id, 'photo', now);
  let asset = await getMediaAsset(t, assetId);
  if (!asset) throw new UserError('Esta foto não está mais no banco de imagens. Envie de novo.');
  if (req.needTag && !asset.tags.includes(req.needTag)) asset = await updateMediaAsset(t, actor, asset.id, { tags: [...asset.tags, req.needTag].slice(0, 7) });
  await close(t, actor, req, { status: 'answered', outcome: 'photo', answered_asset_id: asset.id }, now);
  if (!req.suggestionId || !canUseInPost(asset)) return { usedInPost: false };
  const linked = await t.update('content_suggestions', { asset_id: asset.id }).eq('id', req.suggestionId).eq('status', 'suggested').select('id');
  if (linked.error) throw new Error(`sugestões: ${linked.error.message}`);
  return { usedInPost: !!linked.data?.length };
}

// "Não tenho agora": a sugestão segue sem foto e a regra não pede a mesma coisa por 14 dias.
export async function dismissRequest(t: TenantDb, actor: SessionUser, id: string, now: Date = new Date()): Promise<void> {
  const req = await getRequest(t, id);
  if (!req) throw new UserError('Pedido não encontrado. Recarregue a página.');
  if (req.status !== 'open') throw new UserError(GONE);
  await close(t, actor, req, { status: 'dismissed', outcome: 'dismissed' }, now);
}

// Confirmar, corrigir ou desligar o fato pelo pedido: as mesmas funções e regras da tela de fatos. Corrigir o texto de um
// fato confirmado o devolve para revisão (updateFact); quem corrige pelo pedido confirma o texto novo no mesmo gesto.
export async function answerConfirm(t: TenantDb, actor: SessionUser, id: string, answer: ConfirmAnswer, now: Date = new Date()): Promise<{ outcome: 'kept' | 'edited' | 'off' }> {
  const req = await openRequest(t, id, 'confirm', now);
  const fact = (await listFacts(t)).find((f) => f.id === req.factId);
  if (!fact) throw new UserError('O fato deste pedido não está mais na lista. Recarregue a página.');
  const today = todayLocal(now);
  let outcome: 'kept' | 'edited' | 'off';
  if (answer.action === 'off') {
    await updateFact(t, actor, { id: fact.id, active: false });
    outcome = 'off';
  } else {
    const parsed = parseFactPatch({ id: fact.id, valid_until: answer.validUntil, ...(answer.action === 'edit' ? { text: answer.text } : {}) }, today);
    if (!parsed.ok) throw new UserError(parsed.error);
    const changed = answer.action === 'edit' && parsed.value.text !== undefined && parsed.value.text !== fact.text;
    await updateFact(t, actor, parsed.value);
    if (changed) await confirmFact(t, actor, fact.id);
    outcome = changed ? 'edited' : 'kept';
  }
  await close(t, actor, req, { status: 'answered', outcome }, now);
  return { outcome };
}
