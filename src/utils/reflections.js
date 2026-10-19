// reflections.js — aprendizado de ESTILO a partir das edições humanas.
// hasMeaningfulEdit / buildReflectionBlock são puros (testáveis).
// getActiveStyleRules lê as regras ativas do tenant (best-effort: sem DB → []).

import { usingDb, getDb } from './db.js';

// Normaliza pra comparar CONTEÚDO, não formatação: minúsculas, espaços colapsados.
function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Levenshtein iterativo (duas linhas). O(n·m) — ok pra captions e batches pequenos.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// Edição "significativa" = mudou além de um limiar relativo (ignora ajuste de
// espaço/hashtag). Curto-circuita pela diferença de comprimento antes do O(n·m).
export function hasMeaningfulEdit(original, edited, { minRatio = 0.08 } = {}) {
  const a = normalize(original);
  const b = normalize(edited);
  if (!a || !b || a === b) return false;
  const maxLen = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) / maxLen >= minRatio) return true;
  return levenshtein(a, b) / maxLen >= minRatio;
}

// Monta o bloco injetado no system prompt. Vazio se não há regras.
export function buildReflectionBlock(rules) {
  const list = (rules || []).map(r => (typeof r === 'string' ? r : r?.rule)).filter(Boolean);
  if (!list.length) return '';
  return `## Regras aprendidas com edições anteriores (siga à risca)\n\n${list.map(r => `- ${r}`).join('\n')}`;
}

// Lê as regras de estilo ativas do tenant. Best-effort: sem DB → []. Filtra por
// canal (regra sem canal vale pra todos) e por aspecto: o padrão traz as de texto
// (regra sem aspecto conta como texto); `aspects: ['visual']` traz as do prompt de imagem.
export async function getActiveStyleRules(tenantId, { channel, aspects, limit = 12 } = {}) {
  if (!usingDb()) return [];
  try {
    const { data, error } = await getDb()
      .from('style_rules')
      .select('rule,channel,aspect')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(limit * 3);
    if (error) return [];
    return filterRules(data, { channel, aspects }).slice(0, limit).map(r => r.rule);
  } catch (e) {
    return [];
  }
}

// Pura: canal (sem canal = todos) e aspecto (sem aspecto = texto; visual só se pedido).
export function filterRules(rows, { channel, aspects } = {}) {
  return (rows || [])
    .filter(r => !r.channel || !channel || r.channel === channel)
    .filter(r => (aspects ? aspects.includes(r.aspect) : r.aspect !== 'visual'));
}

export const _internal = { normalize, levenshtein };

// ── Consolidação semanal (reflect.js) ────────────────────────────────────────
// Puras: prompt e validação da saída do modelo. Ficam aqui porque reflect.js roda
// main() ao ser importado.

const RULE_ASPECTS = ['texto', 'visual', 'tom', 'tema', 'formato', 'cta'];
const MAX_DERIVED_RULES = 8;

export function buildReflectPrompt({ tenantName, pairs = [], feedback = [] }) {
  const edits = pairs.slice(0, 12)
    .map((p, i) => `Edição ${i + 1} (${p.channel}):\nSUGERIDO: ${p.suggested}\nEDITADO: ${p.edited}`)
    .join('\n\n');
  const notes = feedback.slice(0, 30)
    .map((f, i) => `Feedback ${i + 1} (${f.sentiment === 'positivo' ? 'gostou' : 'não gostou'}, ${f.aspect}, ${f.channel || 'todas as redes'}): ${f.note}${f.excerpt ? ` [post: "${f.excerpt.slice(0, 80)}"]` : ''}`)
    .join('\n');

  return [
    `Você analisa como o editor de ${tenantName} corrige e avalia os posts gerados.`,
    'Extraia REGRAS que GENERALIZAM: padrões que se repetem ou refletem claramente a preferência',
    'dele. Ignore correção pontual de um único post. Seja conservador.',
    `No máximo ${MAX_DERIVED_RULES} regras, cada uma uma frase imperativa curta.`,
    `Para cada regra informe: aspect (${RULE_ASPECTS.join(' | ')}), channel (instagram | linkedin | twitter,`,
    'ou null se vale pra todas) e source ("edicao" se veio das edições, "feedback" se veio dos feedbacks).',
    'Regra de visual descreve imagem (cor, composição, elementos), nunca texto.',
    '',
    edits ? `## Edições (sugerido x editado)\n\n${edits}` : '',
    notes ? `## Feedbacks do editor\n\n${notes}` : '',
    '',
    'Responda só JSON: {"rules":[{"rule":"...","aspect":"texto","channel":null,"source":"feedback"}]}',
  ].filter(s => s !== '').join('\n');
}

// Valida a saída do modelo na fronteira: descarta o que não tem regra, corrige aspecto e
// origem desconhecidos. Aceita também o formato antigo (lista de strings).
export function normalizeDerivedRules(raw, { channels = ['instagram', 'linkedin', 'twitter'] } = {}) {
  const list = Array.isArray(raw?.rules) ? raw.rules : [];
  return list
    .map(r => (typeof r === 'string' ? { rule: r } : r || {}))
    .filter(r => typeof r.rule === 'string' && r.rule.trim())
    .map(r => ({
      rule: r.rule.trim(),
      aspect: RULE_ASPECTS.includes(r.aspect) ? r.aspect : 'texto',
      channel: channels.includes(r.channel) ? r.channel : null,
      source: r.source === 'feedback' ? 'feedback' : 'edicao',
    }))
    .slice(0, MAX_DERIVED_RULES);
}

export const RULE_CONSTANTS = { RULE_ASPECTS, MAX_DERIVED_RULES };
