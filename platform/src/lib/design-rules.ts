// design-rules.ts: a regra de marca do design, com I/O (SPEC 019, BEZ-270). A decisão do que vira proposta e
// de como a regra se aplica mora em design/rules-model.ts (puro); aqui ficam a leitura das edições da conta, a
// gravação, o aviso ao administrador e as ações de aceitar, dispensar, desligar e desfazer. Tudo pelo
// tenantDb. Nada aqui chama modelo.

import { isStudioDesign } from './studio/is-studio';
import type { TenantDb } from './tenant-db';
import { ConflictError, NotFoundError } from './errors';
import { log } from './log';
import { notify } from './notifications';
import { track } from './analytics';
import { editBlocking } from './design/review';
import { renderPng } from './design/render';
import { storedDesignOf, type DesignSpec, type PostKind, type Ratio, type StoredDesign } from './design/model';
import { applyRules, findProposals, ruleTitle, RULE_WINDOW_DAYS, type DesignRule, type EditedPost, type Proposal, type RuleField, type RuleScope, type RuleStatus, type RuleValue } from './design/rules-model';

const DAY_MS = 86_400_000;
// O "Desfazer" depois de aceitar. A tela mostra o aviso por dez segundos; o servidor aceita por cinco minutos.
export const UNDO_WINDOW_MS = 5 * 60_000;

type Row = Record<string, unknown>;
const COLUMNS = 'id,field,scope,value,status,evidence,explanation,decided_by,decided_at,created_at';

export type RuleView = DesignRule & { title: string; explanation: string; createdAt: string };

const toRule = (r: Row): DesignRule => ({
  id: String(r.id),
  field: r.field as RuleField,
  scope: r.scope as RuleScope,
  value: r.value as RuleValue,
  status: r.status as RuleStatus,
  decidedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
  evidence: (r.evidence as DesignRule['evidence']) ?? null,
});
const toView = (r: Row): RuleView => {
  const rule = toRule(r);
  return { ...rule, title: ruleTitle(rule), explanation: String(r.explanation), createdAt: new Date(r.created_at as string).toISOString() };
};

export async function listRules(t: TenantDb): Promise<RuleView[]> {
  const { data, error } = await t.select('design_rules', COLUMNS).order('created_at', { ascending: false });
  if (error) throw new Error(`design_rules: ${error.message}`);
  return (data ?? []).map(toView);
}

export async function activeRules(t: TenantDb): Promise<DesignRule[]> {
  const { data, error } = await t.select('design_rules', COLUMNS).eq('status', 'active').order('created_at', { ascending: true });
  if (error) throw new Error(`design_rules: ${error.message}`);
  return (data ?? []).map(toRule);
}

// ── Aplicar a um post novo ───────────────────────────────────────────────────

const specOf = (spec: DesignSpec, d: StoredDesign): DesignSpec => ({
  ...spec,
  layout: d.layout,
  texts: d.texts,
  logoCorner: d.logoCorner,
  logoHidden: d.logoHidden,
  colors: d.colors,
});

// As regras ativas da conta sobre o design de um post que está nascendo. O revisor roda com cada regra e a que
// criar um achado novo é pulada: a regra nunca piora o post. Falha ao ler regras nunca derruba a geração.
export async function applyDesignRulesToSpec(t: TenantDb, spec: DesignSpec, fontDir?: string): Promise<{ spec: DesignSpec; applied: string[] }> {
  let rules: DesignRule[];
  try {
    rules = await activeRules(t);
  } catch (e) {
    log('warn', 'design-rules', 'não leu as regras do design; o post sai sem elas', { error: e instanceof Error ? e.message : String(e) });
    return { spec, applied: [] };
  }
  if (!rules.length) return { spec, applied: [] };
  const hasVisual = !!spec.visual;
  const blockers = (d: StoredDesign) => editBlocking(renderPng(specOf(spec, d), fontDir ? { fontDir } : {}).issues).map((i) => i.rule);
  const out = applyRules(storedDesignOf(spec), rules, { kind: spec.kind, hasVisual }, blockers);
  for (const s of out.skipped) if (s.reason === 'would_worsen') log('info', 'design-rules', 'regra pulada: pioraria o post', { rule: s.id });
  if (!out.applied.length) return { spec, applied: [] };
  return { spec: specOf(spec, out.design), applied: out.applied };
}

// ── Propor a partir das edições ──────────────────────────────────────────────

export type RuleProposed = { id: string; title: string; explanation: string };

// Olha as edições dos últimos 30 dias e propõe a regra que se repete em 3 posts diferentes. Só conta o post que
// seguiu: aprovado, ou ainda esperando decisão. Recusado e trocado por "outra direção" não contam.
export async function proposeDesignRules(t: TenantDb, now: Date = new Date()): Promise<RuleProposed[]> {
  const since = new Date(now.getTime() - RULE_WINDOW_DAYS * DAY_MS).toISOString();
  const recent = await t.select('post_design_revisions', 'id,post_design_id,created_at,source').gte('created_at', since).in('source', ['edit', 'layout', 'restore']).order('created_at', { ascending: false }).limit(1000);
  if (recent.error) throw new Error(`post_design_revisions: ${recent.error.message}`);
  const rows = (recent.data ?? []) as Row[];
  const designIds = [...new Set(rows.map((r) => String(r.post_design_id)))];
  if (!designIds.length) return [];

  const [designs, firsts, pendings, existing] = await Promise.all([
    t.select('post_designs', 'id,kind,ratio,design,approved_at').in('id', designIds),
    t.select('post_design_revisions', 'post_design_id,design').eq('version', 1).in('post_design_id', designIds),
    t.select('pending_approvals', 'post_design_id,status,archived_at').in('post_design_id', designIds),
    listRules(t),
  ]);
  for (const r of [designs, firsts, pendings]) if (r.error) throw new Error(`design_rules: ${r.error.message}`);
  const initial = new Map(((firsts.data ?? []) as Row[]).map((r) => [String(r.post_design_id), r.design as StoredDesign]));
  const waiting = new Set(((pendings.data ?? []) as Row[]).filter((p) => p.status === 'awaiting_decision' && !p.archived_at).map((p) => String(p.post_design_id)));

  const posts: EditedPost[] = [];
  for (const d of (designs.data ?? []) as Row[]) {
    const id = String(d.id);
    const first = initial.get(id);
    // A regra de marca nasce de post de uma imagem; o carrossel não entra na conta (SPEC 023).
    if (!first || isStudioDesign(d.design) || (d.design as StoredDesign).slides || !(d.approved_at || waiting.has(id))) continue;
    const mine = rows.filter((r) => String(r.post_design_id) === id);
    posts.push({
      designId: id,
      initial: first,
      current: d.design as StoredDesign,
      ctx: { kind: d.kind as PostKind, layout: (d.design as StoredDesign).layout, ratio: d.ratio as Ratio, goal: null },
      lastEditAt: new Date(mine[0].created_at as string).toISOString(),
      revisionIds: mine.map((r) => String(r.id)),
    });
  }

  const created: RuleProposed[] = [];
  for (const p of findProposals(posts, existing, now)) {
    const made = await saveProposal(t, p, existing);
    if (!made) continue;
    created.push(made);
    await track(t.tenantId, 'design_rule_proposed', { rule_field: p.field, scope_kind: p.scope, evidence_posts: p.posts });
    await notify(t, { kind: 'design.rule_proposed', title: 'A Ekoai notou um ajuste que você repete', body: made.title, link: '/aprendizado?tab=design', audience: 'admin' });
  }
  return created;
}

async function saveProposal(t: TenantDb, p: Proposal, existing: readonly RuleView[]): Promise<RuleProposed | null> {
  const evidence = { posts: p.posts, first_at: p.firstAt, last_at: p.lastAt, revision_ids: p.revisionIds };
  const old = existing.find((r) => r.field === p.field && r.scope === p.scope && r.value === p.value);
  const rule = { field: p.field, scope: p.scope, value: p.value };
  if (old) {
    // dispensada que volta depois do prazo: a mesma linha, de novo como proposta
    const up = await t.update('design_rules', { status: 'proposed', evidence, explanation: p.explanation, decided_by: null, decided_at: null }).eq('id', old.id).eq('status', 'dismissed').select('id');
    if (up.error) throw new Error(`design_rules: ${up.error.message}`);
    return up.data?.length ? { id: old.id, title: ruleTitle(rule), explanation: p.explanation } : null;
  }
  const ins = await t.insert('design_rules', { ...rule, rule_key: p.ruleKey, status: 'proposed', evidence, explanation: p.explanation }).select('id');
  if (ins.error) {
    if (ins.error.code === '23505') return null; // outra edição propôs a mesma regra ao mesmo tempo
    throw new Error(`design_rules: ${ins.error.message}`);
  }
  return { id: String(ins.data![0].id), title: ruleTitle(rule), explanation: p.explanation };
}

// ── Decidir ──────────────────────────────────────────────────────────────────

async function load(t: TenantDb, id: string): Promise<DesignRule> {
  const { data, error } = await t.select('design_rules', COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`design_rules: ${error.message}`);
  if (!data) throw new NotFoundError('Regra não encontrada. Recarregue a página.');
  return toRule(data);
}

async function move(t: TenantDb, id: string, from: RuleStatus[], values: Row): Promise<RuleView> {
  const { data, error } = await t.update('design_rules', values).eq('id', id).in('status', from).select(COLUMNS);
  if (error) {
    if (error.code === '23505') throw new ConflictError('Já existe outra regra ativa para este campo. Recarregue a página.');
    throw new Error(`design_rules: ${error.message}`);
  }
  if (!data?.length) throw new ConflictError('A regra mudou enquanto você olhava. Recarregue a página.');
  return toView(data[0]);
}

export type Decision = { rule: RuleView; turnedOff: string[] };

// Aceitar (da proposta) e Ligar de novo (da desligada) levam a ativa. Uma regra ativa por campo e escopo: a
// que estava ativa no mesmo campo desliga, e a resposta diz qual.
export async function activateRule(t: TenantDb, id: string, userId: string | null, from: 'proposed' | 'off'): Promise<Decision> {
  const rule = await load(t, id);
  if (rule.status !== from) throw new ConflictError('A regra mudou enquanto você olhava. Recarregue a página.');
  const others = await t.select('design_rules', COLUMNS).eq('scope', rule.scope).eq('field', rule.field).eq('status', 'active').neq('id', id);
  if (others.error) throw new Error(`design_rules: ${others.error.message}`);
  const turnedOff: string[] = [];
  for (const o of (others.data ?? []) as Row[]) {
    const off = await t.update('design_rules', { status: 'off', decided_by: userId, decided_at: new Date().toISOString() }).eq('id', String(o.id)).eq('status', 'active');
    if (off.error) throw new Error(`design_rules: ${off.error.message}`);
    turnedOff.push(ruleTitle(toRule(o)));
  }
  const view = await move(t, id, [from], { status: 'active', decided_by: userId, decided_at: new Date().toISOString() });
  await track(t.tenantId, 'design_rule_accepted', { rule_field: view.field, scope_kind: view.scope, evidence_posts: view.evidence?.posts ?? 0, via: from === 'proposed' ? 'accept' : 'enable' });
  return { rule: view, turnedOff };
}

export async function dismissRule(t: TenantDb, id: string, userId: string | null): Promise<RuleView> {
  const view = await move(t, id, ['proposed'], { status: 'dismissed', decided_by: userId, decided_at: new Date().toISOString() });
  await track(t.tenantId, 'design_rule_dismissed', { rule_field: view.field, scope_kind: view.scope, evidence_posts: view.evidence?.posts ?? 0 });
  return view;
}

export async function disableRule(t: TenantDb, id: string, userId: string | null): Promise<RuleView> {
  const view = await move(t, id, ['active'], { status: 'off', decided_by: userId, decided_at: new Date().toISOString() });
  await track(t.tenantId, 'design_rule_disabled', { rule_field: view.field, scope_kind: view.scope, evidence_posts: view.evidence?.posts ?? 0, via: 'toggle' });
  return view;
}

// Desfazer o aceite logo depois de aceitar: a regra volta a proposta, como se não tivesse sido decidida.
export async function undoRule(t: TenantDb, id: string, now: Date = new Date()): Promise<RuleView> {
  const rule = await load(t, id);
  if (rule.status !== 'active' || !rule.decidedAt || now.getTime() - Date.parse(rule.decidedAt) > UNDO_WINDOW_MS) {
    throw new ConflictError('O prazo para desfazer passou. Use Desligar para parar de aplicar a regra.');
  }
  const view = await move(t, id, ['active'], { status: 'proposed', decided_by: null, decided_at: null });
  await track(t.tenantId, 'design_rule_disabled', { rule_field: view.field, scope_kind: view.scope, evidence_posts: view.evidence?.posts ?? 0, via: 'undo' });
  return view;
}

