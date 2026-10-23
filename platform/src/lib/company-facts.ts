// company-facts.ts: ler e gravar os fatos da empresa de uma conta (SPEC 012, decisão 5; SPEC 018, ADR 0019).
// Tudo pelo tenantDb: o tenant vem da sessão. Quem lê (profile.view) e quem escreve (brand.manage) é decidido
// na rota e na RLS. A auditoria registra a ação, nunca o texto.
//
// Fato escrito por uma pessoa nasce confirmado por ela. Fato escrito por agente ou importação nasce
// pendente e só uma pessoa confirma: nenhum caminho daqui grava `confirmed` para `proposed_by = 'agent'`
// sem passar por `confirmFact`.

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { auditTenant } from './audit';
import { factFromRow, MAX_FACTS_PER_ACCOUNT, type AgentFactInput, type CompanyFact, type FactInput, type FactPatch } from './company-facts-model';

const COLUMNS = 'id,kind,text,source,source_note,active,created_at,status,category,proposed_by,verified_at,approved_by,valid_until,expiry_notice';
const NOT_FOUND = 'Fato não encontrado. Recarregue a página.';

export async function listFacts(t: TenantDb): Promise<CompanyFact[]> {
  const { data, error } = await t.select('company_facts', COLUMNS).order('kind').order('created_at', { ascending: true });
  if (error) throw new Error(`fatos: ${error.message}`);
  return (data ?? []).map(factFromRow);
}

async function assertRoom(t: TenantDb): Promise<void> {
  const total = await t.select('company_facts', 'id', { count: 'exact', head: true });
  if (total.error) throw new Error(`fatos: ${total.error.message}`);
  if ((total.count ?? 0) >= MAX_FACTS_PER_ACCOUNT) {
    throw new UserError(`A conta já tem ${MAX_FACTS_PER_ACCOUNT} fatos. Apague ou desligue algum antes de adicionar outro.`);
  }
}

// Quem digita o fato o confirma no mesmo gesto: vale desde agora.
export async function createFact(t: TenantDb, actor: SessionUser, input: FactInput): Promise<CompanyFact> {
  await assertRoom(t);
  const now = new Date().toISOString();
  const { data, error } = await t
    .insert('company_facts', { ...input, status: 'confirmed', proposed_by: 'person', verified_at: now, approved_by: actor.id, created_by: actor.id })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`fatos: ${error.message}`);
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.created', targetType: 'company_fact', targetId: String(data!.id), metadata: { kind: input.kind, source: input.source } });
  return factFromRow(data!);
}

// Contrato de entrada da importação do site e do kit da marca (BEZ-192 e 197): sempre pendente, sempre
// de agente, sem ator. Só uma pessoa confirma depois, por `confirmFact`.
export async function createAgentFact(t: TenantDb, input: AgentFactInput): Promise<CompanyFact> {
  await assertRoom(t);
  const { data, error } = await t
    .insert('company_facts', { ...input, status: 'pending', proposed_by: 'agent', verified_at: null, approved_by: null })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`fatos: ${error.message}`);
  await auditTenant(t, { actorUserId: null, actorKind: 'system', action: 'facts.proposed', targetType: 'company_fact', targetId: String(data!.id), metadata: { source: input.source } });
  return factFromRow(data!);
}

export async function updateFact(t: TenantDb, actor: SessionUser, patch: FactPatch): Promise<void> {
  const { id, ...values } = patch;
  const current = await t.select('company_facts', 'text,kind,status').eq('id', id).maybeSingle();
  if (current.error) throw new Error(`fatos: ${current.error.message}`);
  if (!current.data) throw new UserError(NOT_FOUND);
  const extra: Record<string, unknown> = {};
  // A confirmação era do texto antigo: mudar o texto de um fato confirmado o devolve para revisão.
  if (values.text !== undefined && values.text !== current.data.text && current.data.kind === 'fact' && current.data.status === 'confirmed') {
    Object.assign(extra, { status: 'pending', verified_at: null, approved_by: null });
  }
  // Prazo novo: o aviso de vencimento pode sair de novo.
  if (values.valid_until !== undefined) extra.expiry_notice = null;
  const { data, error } = await t.update('company_facts', { ...values, ...extra }).eq('id', id).select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  if (!data?.length) throw new UserError(NOT_FOUND);
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.updated', targetType: 'company_fact', targetId: id, metadata: { fields: Object.keys(values), reviewAgain: extra.status === 'pending' } });
}

export async function deleteFact(t: TenantDb, actor: SessionUser, id: string): Promise<void> {
  const { data, error } = await t.delete('company_facts').eq('id', id).select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  if (!data?.length) throw new UserError(NOT_FOUND);
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.deleted', targetType: 'company_fact', targetId: id });
}

// Pendente para confirmado. Só muda o que ainda está pendente: dois cliques ao mesmo tempo, um passa.
// `valid_until` opcional: a pessoa pode ajustar o prazo no mesmo gesto.
export async function confirmFacts(t: TenantDb, actor: SessionUser, ids: string[], validUntil?: string | null): Promise<number> {
  const values: Record<string, unknown> = { status: 'confirmed', verified_at: new Date().toISOString(), approved_by: actor.id };
  if (validUntil !== undefined) Object.assign(values, { valid_until: validUntil, expiry_notice: null });
  const { data, error } = await t.update('company_facts', values).in('id', ids).eq('status', 'pending').select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  const done = data?.length ?? 0;
  if (!done) throw new UserError('Nenhum destes fatos está esperando confirmação. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.confirmed', targetType: 'company_fact', targetId: ids.length === 1 ? ids[0] : undefined, metadata: { count: done } });
  return done;
}

export const confirmFact = (t: TenantDb, actor: SessionUser, id: string, validUntil?: string | null) => confirmFacts(t, actor, [id], validUntil);

// Pendente para recusado: o fato fica guardado, mas nunca entra num post.
export async function rejectFact(t: TenantDb, actor: SessionUser, id: string): Promise<void> {
  const { data, error } = await t.update('company_facts', { status: 'rejected', verified_at: null, approved_by: null }).eq('id', id).eq('status', 'pending').select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  if (!data?.length) throw new UserError('Este fato não está esperando confirmação. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.rejected', targetType: 'company_fact', targetId: id });
}

// Recusado volta a pendente (desfazer): quem recusou sem querer revisa de novo.
export async function restoreFact(t: TenantDb, actor: SessionUser, id: string): Promise<void> {
  const { data, error } = await t.update('company_facts', { status: 'pending' }).eq('id', id).eq('status', 'rejected').select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  if (!data?.length) throw new UserError('Este fato não está recusado. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.restored', targetType: 'company_fact', targetId: id });
}
