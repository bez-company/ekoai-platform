// company-facts.ts: ler e gravar os fatos da empresa de uma conta (SPEC 012, decisão 5). Tudo pelo
// tenantDb: o tenant vem da sessão. Quem lê (profile.view) e quem escreve (brand.manage) é decidido
// na rota e na RLS. A auditoria registra a ação, nunca o texto.

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { auditTenant } from './audit';
import { factFromRow, MAX_FACTS_PER_ACCOUNT, type CompanyFact, type FactInput, type FactPatch } from './company-facts-model';

const COLUMNS = 'id,kind,text,source,source_note,active,created_at';

export async function listFacts(t: TenantDb): Promise<CompanyFact[]> {
  const { data, error } = await t.select('company_facts', COLUMNS).order('kind').order('created_at', { ascending: true });
  if (error) throw new Error(`fatos: ${error.message}`);
  return (data ?? []).map(factFromRow);
}

export async function createFact(t: TenantDb, actor: SessionUser, input: FactInput): Promise<CompanyFact> {
  const total = await t.select('company_facts', 'id', { count: 'exact', head: true });
  if (total.error) throw new Error(`fatos: ${total.error.message}`);
  if ((total.count ?? 0) >= MAX_FACTS_PER_ACCOUNT) {
    throw new UserError(`A conta já tem ${MAX_FACTS_PER_ACCOUNT} fatos. Apague ou desligue algum antes de adicionar outro.`);
  }
  const { data, error } = await t.insert('company_facts', { ...input, created_by: actor.id }).select(COLUMNS).single();
  if (error) throw new Error(`fatos: ${error.message}`);
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.created', targetType: 'company_fact', targetId: String(data!.id), metadata: { kind: input.kind, source: input.source } });
  return factFromRow(data!);
}

export async function updateFact(t: TenantDb, actor: SessionUser, patch: FactPatch): Promise<void> {
  const { id, ...values } = patch;
  const { data, error } = await t.update('company_facts', values).eq('id', id).select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  if (!data?.length) throw new UserError('Fato não encontrado. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.updated', targetType: 'company_fact', targetId: id, metadata: { fields: Object.keys(values) } });
}

export async function deleteFact(t: TenantDb, actor: SessionUser, id: string): Promise<void> {
  const { data, error } = await t.delete('company_facts').eq('id', id).select('id');
  if (error) throw new Error(`fatos: ${error.message}`);
  if (!data?.length) throw new UserError('Fato não encontrado. Recarregue a página.');
  await auditTenant(t, { actorUserId: actor.id, action: 'facts.deleted', targetType: 'company_fact', targetId: id });
}
