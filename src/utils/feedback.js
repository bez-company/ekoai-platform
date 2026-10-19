// feedback.js: "o que não gostei" (SPEC 003 R4). O feedback recente entra direto no
// prompt (efeito na próxima geração); o reflect semanal consolida em style_rules.
// Visual vai pro prompt de imagem, o resto pro de texto. Builders são puros (testáveis);
// leituras são best-effort (sem DB → []).

import { usingDb, getDb } from './db.js';
import { getActiveStyleRules } from './reflections.js';

export const ASPECTS = ['texto', 'visual', 'tom', 'tema', 'formato', 'cta'];
export const TEXT_ASPECTS = ASPECTS.filter(a => a !== 'visual');

const RECENT_DAYS = 14;
const MAX_PER_SENTIMENT = 8;

// Feedback do tenant nos últimos `days` dias. Com `channel`, traz o daquele canal e o
// que vale pra todas as redes (channel null).
export async function getRecentFeedback(tenantId, { channel, days = RECENT_DAYS, limit = 40, now = new Date() } = {}) {
  if (!usingDb()) return [];
  try {
    const since = new Date(now.getTime() - days * 86400 * 1000).toISOString();
    const { data, error } = await getDb()
      .from('feedback')
      .select('channel,aspect,sentiment,note,excerpt,created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).filter(f => !f.channel || !channel || f.channel === channel);
  } catch (e) {
    return [];
  }
}

function pick(items, aspects, sentiment) {
  return (items || [])
    .filter(f => aspects.includes(f.aspect) && (f.sentiment || 'negativo') === sentiment && f.note?.trim())
    .slice(0, MAX_PER_SENTIMENT);
}

function groupLines(items) {
  const byAspect = new Map();
  for (const f of items) {
    const line = f.excerpt ? `${f.note.trim()} (no post "${f.excerpt.slice(0, 60)}")` : f.note.trim();
    byAspect.set(f.aspect, [...(byAspect.get(f.aspect) || []), line]);
  }
  return [...byAspect].map(([aspect, lines]) => `### ${aspect}\n${lines.map(l => `- ${l}`).join('\n')}`).join('\n\n');
}

// Bloco do system prompt de texto. Vazio se não há feedback nos aspectos pedidos.
export function buildFeedbackBlock(items, { aspects = TEXT_ASPECTS } = {}) {
  const negative = pick(items, aspects, 'negativo');
  const positive = pick(items, aspects, 'positivo');
  const parts = [];
  if (negative.length) {
    parts.push(`## Evite: o editor reclamou disso em posts recentes (não repita)\n\n${groupLines(negative)}`);
  }
  if (positive.length) {
    parts.push(`## Mantenha: o editor gostou disso em posts recentes\n\n${groupLines(positive)}`);
  }
  return parts.join('\n\n');
}

// Orientação pro modelo de imagem: regras de visual + feedback visual recente.
export function buildImageGuidance(rules, items) {
  const avoid = [...(rules || []), ...pick(items, ['visual'], 'negativo').map(f => `evitar: ${f.note.trim()}`)];
  const keep = pick(items, ['visual'], 'positivo').map(f => `manter: ${f.note.trim()}`);
  const lines = [...avoid, ...keep];
  if (!lines.length) return '';
  return `Editor guidance (follow strictly, written in Portuguese):\n${lines.map(l => `- ${l}`).join('\n')}`;
}

// Uma leitura por processo/canal: as 3 variações de uma rodada usam a mesma orientação.
const guidanceCache = new Map();
export async function getVisualGuidance(tenantId, channel) {
  const key = `${tenantId}:${channel || '*'}`;
  if (!guidanceCache.has(key)) {
    guidanceCache.set(key, (async () => {
      const [rules, items] = await Promise.all([
        getActiveStyleRules(tenantId, { channel, aspects: ['visual'] }),
        getRecentFeedback(tenantId, { channel }),
      ]);
      return buildImageGuidance(rules, items);
    })());
  }
  return guidanceCache.get(key);
}

export const _internal = { RECENT_DAYS, MAX_PER_SENTIMENT, guidanceCache };
