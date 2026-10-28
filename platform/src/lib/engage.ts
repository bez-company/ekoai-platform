// engage.ts: engajamento no LinkedIn (SPEC 005 R3), lado servidor. Rascunha 3 opções com a
// voz e as regras aprendidas, publica pela API só com clique e dentro dos limites, e registra
// tudo em `engagements`. Quando a API recusa, o rascunho fica pronto pra copiar e colar.

import type { TenantDb } from './tenant-db';
import { generateJson } from './gemini';
import * as linkedin from './channels/linkedin';
import { linkedinCredentials } from './social-accounts';
import {
  buildEngagePrompt,
  checkRateLimit,
  dayStartIso,
  normalizeOptions,
  shouldOfferCopy,
  weekStartIso,
  type DraftInput,
  type EngageKind,
} from './engage-model';
import { UserError } from './errors';

export type Engagement = {
  id: string;
  kind: EngageKind;
  target_url: string;
  target_author: string | null;
  target_text: string;
  options: string[] | null;
  comment_text: string | null;
  status: 'rascunho' | 'publicado' | 'copiado' | 'falhou';
  error: string | null;
  created_at: string;
  posted_at: string | null;
};

export type EngageTarget = { id: string; name: string; profile_url: string; note: string | null; active: boolean };

const TEXT_ASPECTS = ['texto', 'tom'];

// Regras de texto e tom + feedback negativo recente: o comentário fala com a mesma voz dos posts.
async function learnedVoice(t: TenantDb): Promise<{ rules: string[]; avoid: string[] }> {
  const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  const [rules, feedback] = await Promise.all([
    t.select('style_rules', 'rule,aspect').eq('active', true).limit(30),
    t
      .select('feedback', 'note,aspect')
      .eq('sentiment', 'negativo')
      .gte('created_at', since)
      .limit(20),
  ]);
  return {
    rules: (rules.data || []).filter((r) => !r.aspect || TEXT_ASPECTS.includes(r.aspect)).map((r) => r.rule).slice(0, 12),
    avoid: (feedback.data || []).filter((f) => TEXT_ASPECTS.includes(f.aspect)).map((f) => f.note).slice(0, 8),
  };
}

export async function draftEngagement(t: TenantDb, input: DraftInput): Promise<{ id: string; options: string[] }> {
  const voice = await learnedVoice(t).catch(() => ({ rules: [], avoid: [] }));
  const prompt = buildEngagePrompt({ kind: input.target.kind, targetText: input.targetText, author: input.author, ...voice });
  const options = normalizeOptions(await generateJson(prompt));
  if (!options.length) throw new UserError('O modelo não devolveu sugestões. Tente gerar de novo.');

  const { data, error } = await t
    .insert('engagements', {
      kind: input.target.kind,
      target_url: input.url,
      target_urn: input.target.object,
      parent_comment_urn: input.target.parentComment,
      target_author: input.author,
      target_text: input.targetText,
      options,
      status: 'rascunho',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Falha ao salvar o rascunho: ${error.message}`);
  return { id: data!.id as string, options };
}

async function usage(t: TenantDb): Promise<{ postedToday: number; postedThisWeek: number; lastPostedAt: string | null }> {
  const base = () => t.select('engagements', 'id', { count: 'exact', head: true });
  const [today, week, last] = await Promise.all([
    base().eq('status', 'publicado').gte('posted_at', dayStartIso()),
    base().in('status', ['publicado', 'copiado']).gte('posted_at', weekStartIso()),
    t
      .select('engagements', 'posted_at')
      .eq('status', 'publicado')
      .order('posted_at', { ascending: false })
      .limit(1),
  ]);
  return {
    postedToday: today.count ?? 0,
    postedThisWeek: week.count ?? 0,
    lastPostedAt: (last.data?.[0]?.posted_at as string) ?? null,
  };
}

export async function getEngageSummary(t: TenantDb): Promise<{ postedToday: number; postedThisWeek: number }> {
  const u = await usage(t);
  return { postedToday: u.postedToday, postedThisWeek: u.postedThisWeek };
}

async function loadDraft(t: TenantDb, id: string) {
  const { data, error } = await t.select('engagements').eq('id', id).limit(1);
  if (error) throw new Error(`Falha ao ler o rascunho: ${error.message}`);
  const row = data?.[0];
  if (!row) throw new UserError('Rascunho não encontrado. Gere as sugestões de novo.');
  if (row.status === 'publicado') throw new UserError('Esse comentário já foi publicado.');
  return row;
}

// Publica pela API. Falha da API não lança: volta { ok: false, offerCopy } pra tela oferecer
// copiar e abrir o post, e o registro fica como `falhou` com o erro.
export async function publishEngagement(
  t: TenantDb,
  id: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string; offerCopy: boolean }> {
  const row = await loadDraft(t, id);
  const limit = checkRateLimit(await usage(t));
  if (!limit.ok) return { ok: false, error: limit.error, offerCopy: true };

  try {
    const r = await linkedin.commentOnPost(await linkedinCredentials(t), row.target_urn, text, { parentComment: row.parent_comment_urn });
    await t
      .update('engagements', { status: 'publicado', comment_text: text, comment_urn: r.id, error: null, posted_at: new Date().toISOString() })
      .eq('id', id);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await t.update('engagements', { status: 'falhou', comment_text: text, error: msg }).eq('id', id);
    return { ok: false, error: msg, offerCopy: shouldOfferCopy(msg) };
  }
}

// "Copiar e abrir o post": conta pra meta da semana, não pro limite da API.
export async function markCopied(t: TenantDb, id: string, text: string): Promise<void> {
  await loadDraft(t, id);
  const { error } = await t
    .update('engagements', { status: 'copiado', comment_text: text, posted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Falha ao registrar: ${error.message}`);
}

export async function listEngagements(t: TenantDb, limit = 30): Promise<Engagement[]> {
  const { data, error } = await t
    .select('engagements', 'id,kind,target_url,target_author,target_text,options,comment_text,status,error,created_at,posted_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Falha ao ler o engajamento: ${error.message}`);
  return (data || []) as Engagement[];
}

export async function listTargets(t: TenantDb): Promise<EngageTarget[]> {
  const { data, error } = await t
    .select('engage_targets', 'id,name,profile_url,note,active')
    .eq('active', true)
    .order('name');
  if (error) throw new Error(`Falha ao ler as contas-alvo: ${error.message}`);
  return (data || []) as EngageTarget[];
}

export async function addTarget(t: TenantDb, input: { name: string; profile_url: string; note: string | null }): Promise<void> {
  const { error } = await t.insert('engage_targets', input);
  if (error) throw new Error(`Falha ao salvar a conta: ${error.message}`);
}

export async function removeTarget(t: TenantDb, id: string): Promise<void> {
  const { error } = await t.update('engage_targets', { active: false }).eq('id', id);
  if (error) throw new Error(`Falha ao remover a conta: ${error.message}`);
}
