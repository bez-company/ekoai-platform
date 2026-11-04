// feedback.ts: leitura e escrita de feedback e regras aprendidas (SPEC 003 R4/R5).
// Server-only (service role). A validação do que chega acontece antes, em learning.ts.

import type { TenantDb } from './tenant-db';
import type { Feedback, FeedbackInput, RuleInput, StyleRule } from './learning';
import { personProfiles } from './accounts';
import { getCampaign } from './campaigns';
import { NotFoundError, UserError } from './errors';
import { MAX_RULE_VERSIONS, changeOf, rulesFor, versionFromRow, type RuleChange, type RuleVersion } from './rule-scope';

export async function saveFeedback(t: TenantDb, input: FeedbackInput): Promise<string> {
  const { data, error } = await t
    .insert('feedback', input)
    .select('id')
    .single();
  if (error) throw new Error(`Falha ao gravar feedback: ${error.message}`);
  return data!.id as string;
}

export async function deleteFeedback(t: TenantDb, id: string): Promise<void> {
  const { error } = await t.delete('feedback').eq('id', id);
  if (error) throw new Error(`Falha ao apagar feedback: ${error.message}`);
}

export async function getRecentFeedback(t: TenantDb, limit = 30): Promise<Feedback[]> {
  const { data, error } = await t
    .select('feedback')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Falha ao ler feedback: ${error.message}`);
  return (data || []) as Feedback[];
}

export async function getRules(t: TenantDb): Promise<StyleRule[]> {
  const { data, error } = await t
    .select('style_rules', 'id,rule,aspect,channel,source,active,evidence,campaign_id,created_at')
    .order('active', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Falha ao ler regras: ${error.message}`);
  return (data || []) as StyleRule[];
}

// O texto das regras que entram num post (SPEC 037): as da marca e, com campanha em vigor, as dela. Para quem só tem o
// id da campanha (o estúdio); quem já leu a campanha usa rulesFor direto.
export async function rulesForCampaign(t: TenantDb, campaignId: string | null): Promise<string[]> {
  const [rules, campaign] = await Promise.all([getRules(t), campaignId ? getCampaign(t, campaignId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null]);
  return rulesFor(rules, campaign);
}

type RuleRow = { id: string; rule: string; aspect: string | null; channel: string | null; campaign_id: string | null; active: boolean };

// Uma versão nova com o estado da regra depois da mudança. Passou de 50, as mais antigas saem.
async function recordVersion(t: TenantDb, row: RuleRow, change: RuleChange, actorId: string | null): Promise<void> {
  const last = await t.select('style_rule_versions', 'version').eq('rule_id', row.id).order('version', { ascending: false }).limit(1).maybeSingle();
  if (last.error) throw new Error(`Falha ao ler versões: ${last.error.message}`);
  const version = Number(last.data?.version ?? 0) + 1;
  const ins = await t.insert('style_rule_versions', { rule_id: row.id, version, rule: row.rule, aspect: row.aspect, channel: row.channel, campaign_id: row.campaign_id, active: row.active, change, changed_by: actorId });
  if (ins.error) throw new Error(`Falha ao gravar versão: ${ins.error.message}`);
  if (version > MAX_RULE_VERSIONS) {
    const old = await t.delete('style_rule_versions').eq('rule_id', row.id).lte('version', version - MAX_RULE_VERSIONS);
    if (old.error) throw new Error(`Falha ao podar versões: ${old.error.message}`);
  }
}

async function ruleRow(t: TenantDb, id: string): Promise<RuleRow> {
  const { data, error } = await t.select('style_rules', 'id,rule,aspect,channel,campaign_id,active').eq('id', id).maybeSingle();
  if (error) throw new Error(`Falha ao ler regra: ${error.message}`);
  if (!data) throw new NotFoundError('Regra não encontrada. Recarregue a página.');
  return data as RuleRow;
}

// A campanha da regra precisa ser desta conta; senão a regra entraria nos posts de ninguém.
async function assertCampaign(t: TenantDb, campaignId: string | null): Promise<void> {
  if (!campaignId) return;
  try {
    await getCampaign(t, campaignId);
  } catch (e) {
    if (e instanceof NotFoundError) throw new UserError('Campanha não encontrada. Escolha de novo onde a regra vale.');
    throw e;
  }
}

export async function createRule(t: TenantDb, input: RuleInput, actorId: string | null = null): Promise<string> {
  await assertCampaign(t, input.campaign_id);
  const { data, error } = await t
    .insert('style_rules', { ...input, source: 'manual', active: true })
    .select('id,rule,aspect,channel,campaign_id,active')
    .single();
  if (error) throw new Error(`Falha ao criar regra: ${error.message}`);
  await recordVersion(t, data as RuleRow, 'created', actorId);
  return (data as RuleRow).id;
}

// Reescrever uma regra a torna manual. Toda mudança guarda uma versão (SPEC 037).
export async function updateRule(
  t: TenantDb,
  id: string,
  patch: { active?: boolean; input?: RuleInput },
  actorId: string | null = null,
): Promise<void> {
  if (patch.input) await assertCampaign(t, patch.input.campaign_id);
  const update: Record<string, unknown> = {};
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.input) Object.assign(update, patch.input, { source: 'manual' });
  const { data, error } = await t.update('style_rules', update).eq('id', id).select('id,rule,aspect,channel,campaign_id,active').maybeSingle();
  if (error) throw new Error(`Falha ao alterar regra: ${error.message}`);
  if (!data) throw new NotFoundError('Regra não encontrada. Recarregue a página.');
  await recordVersion(t, data as RuleRow, changeOf({ active: patch.active, edited: !!patch.input }), actorId);
}

// O histórico da regra, da versão mais nova para a mais antiga, com o nome de quem mudou.
export async function listRuleVersions(t: TenantDb, id: string): Promise<RuleVersion[]> {
  await ruleRow(t, id);
  const { data, error } = await t.select('style_rule_versions', 'version,rule,aspect,channel,campaign_id,active,change,changed_by,created_at').eq('rule_id', id).order('version', { ascending: false }).limit(MAX_RULE_VERSIONS);
  if (error) throw new Error(`Falha ao ler versões: ${error.message}`);
  const ids = [...new Set((data ?? []).map((v) => v.changed_by as string | null).filter((x): x is string => !!x))];
  // O nome de quem mudou, pelo mesmo caminho da tela de Equipe (users não tem tenant_id).
  const people = await personProfiles(ids);
  const who = (id: unknown) => (id ? people.get(String(id))?.name || 'Alguém da equipe' : null);
  return (data ?? []).map((v) => versionFromRow({ ...v, changed_by_name: who(v.changed_by) }));
}

// Voltar para uma versão: traz o texto, o aspecto, a rede e o escopo dela, sem mexer em ligada ou desligada. Cria uma versão
// nova; nada se apaga.
export async function restoreRuleVersion(t: TenantDb, id: string, version: number, actorId: string | null = null): Promise<void> {
  await ruleRow(t, id);
  const { data, error } = await t.select('style_rule_versions', 'rule,aspect,channel,campaign_id').eq('rule_id', id).eq('version', version).maybeSingle();
  if (error) throw new Error(`Falha ao ler versão: ${error.message}`);
  if (!data) throw new UserError('Esta versão não está mais no histórico. Recarregue a página.');
  const campaignId = (data.campaign_id as string | null) ?? null;
  // A campanha da versão pode ter sido apagada: a regra volta para a marca toda só se a pessoa escolher isso depois.
  await assertCampaign(t, campaignId);
  const upd = await t.update('style_rules', { rule: data.rule, aspect: data.aspect, channel: data.channel, campaign_id: campaignId, source: 'manual' }).eq('id', id).select('id,rule,aspect,channel,campaign_id,active').maybeSingle();
  if (upd.error) throw new Error(`Falha ao restaurar regra: ${upd.error.message}`);
  await recordVersion(t, upd.data as RuleRow, 'restored', actorId);
}
