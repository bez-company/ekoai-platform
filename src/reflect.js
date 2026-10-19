// reflect.js: REFLECTION (npm run reflect). Aprende com o editor: compara a legenda
// sugerida (composeCaption da variação gerada) com a caption_final editada no cockpit,
// lê o feedback "o que não gostei" (SPEC 003 R4) e via Gemini deriva REGRAS duráveis,
// com aspecto e canal, salvas por tenant em style_rules. Regras de visual vão pro
// prompt de imagem; as outras, pro de texto (generate.js). Regras manuais (criadas ou
// editadas na plataforma) nunca são desligadas aqui.
// Roda por tenant (env TENANT_ID). Best-effort: sem API / sem sinal → no-op.

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { usingDb, getDb, assertStateBackend } from './utils/db.js';
import { composeCaption } from './generate.js';
import { hasMeaningfulEdit, buildReflectPrompt, normalizeDerivedRules } from './utils/reflections.js';
import { resolveTenant } from './tenant.js';

const MODEL = 'gemini-2.5-flash';

function log(...args) {
  console.log('[reflect]', ...args);
}

// Coleta pares (sugerido, editado) de scheduled_posts do tenant onde houve
// edição significativa. A legenda sugerida é reconstruída da variação gerada.
async function collectEdits(tenantId, { limit = 40 } = {}) {
  const { data, error } = await getDb()
    .from('scheduled_posts')
    .select('variation,caption_final,channel,created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Falha ao ler scheduled_posts: ${error.message}`);

  const pairs = [];
  for (const row of data || []) {
    const suggested = composeCaption(row.variation || {});
    const edited = row.caption_final || '';
    if (suggested && edited && hasMeaningfulEdit(suggested, edited)) {
      pairs.push({ channel: row.channel, suggested, edited });
    }
  }
  return pairs;
}

// Feedback do editor dos últimos `days` dias (positivo e negativo, todos os aspectos).
async function collectFeedback(tenantId, { days = 90, limit = 60 } = {}) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const { data, error } = await getDb()
    .from('feedback')
    .select('channel,aspect,sentiment,note,excerpt,created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Falha ao ler feedback: ${error.message}`);
  return data || [];
}

// Gemini extrai regras GENERALIZÁVEIS das edições e feedbacks. Best-effort → [].
async function deriveStyleRules({ pairs, feedback }, tenant) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || (!pairs.length && !feedback.length)) return [];
  const client = new GoogleGenAI({ apiKey });
  const prompt = buildReflectPrompt({ tenantName: tenant.name, pairs, feedback });

  try {
    const res = await client.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { maxOutputTokens: 1200, responseMimeType: 'application/json' },
    });
    const cleaned = (res.text || '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return normalizeDerivedRules(JSON.parse(cleaned), { channels: tenant.channels });
  } catch (e) {
    log(`falha ao derivar regras: ${e.message}`);
    return [];
  }
}

// Snapshot do aprendizado atual: desativa as regras DERIVADAS antigas do tenant e grava
// as novas. Manual fica como está. Mantém histórico (active=false) em vez de apagar.
async function persistRules(tenantId, rules, evidence) {
  if (!rules.length) return;
  await getDb()
    .from('style_rules')
    .update({ active: false })
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('source', ['edicao', 'feedback']);
  const rows = rules.map(r => ({ tenant_id: tenantId, ...r, evidence }));
  const { error } = await getDb().from('style_rules').insert(rows);
  if (error) throw new Error(`Falha ao gravar style_rules: ${error.message}`);
}

async function main() {
  assertStateBackend();
  const tenant = resolveTenant();
  if (!usingDb()) {
    log('STATE_BACKEND≠postgres — reflection precisa do banco (lê scheduled_posts). Saindo.');
    return;
  }
  log(`reflection | tenant=${tenant.id}`);

  const [pairs, feedback] = await Promise.all([collectEdits(tenant.id), collectFeedback(tenant.id)]);
  log(`${pairs.length} edição(ões) significativa(s), ${feedback.length} feedback(s)`);
  if (!pairs.length && !feedback.length) {
    log('Nada a aprender por ora (edite a legenda ou registre feedback na plataforma pra gerar sinal).');
    return;
  }

  const rules = await deriveStyleRules({ pairs, feedback }, tenant);
  log(`${rules.length} regra(s) derivada(s): ${JSON.stringify(rules)}`);
  if (!rules.length) return;

  await persistRules(tenant.id, rules, { samples: pairs.length, edits: pairs.length, feedback: feedback.length });
  log('Regras atualizadas — entram nas próximas gerações.');
}

main().catch((err) => {
  console.error('[reflect] ERRO:', err);
  process.exit(1);
});
