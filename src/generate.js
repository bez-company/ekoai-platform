// generate.js — gera 3 variações de post via Gemini API com few-shot.
// Chamado por: src/index.js. Lê: docs/, prompts/, content/examples/.

import { GoogleGenAI } from '@google/genai';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chooseNextPillar, chooseNextAngle, chooseNextFormat, pillarPosteriors } from './utils/ranking.js';
import { getPublished, isRealPost } from './utils/queue.js';
import { pickAutoExamples } from './utils/examples.js';
import { usingDb, getDb } from './utils/db.js';
import { retrieve } from './utils/rag.js';
import { withRetry } from './utils/retry.js';
import { resolveTenant } from './tenant.js';
import { getActiveStyleRules, buildReflectionBlock } from './utils/reflections.js';
import { croquisPromptList } from './utils/croquis.js';
import { getRecentFeedback, buildFeedbackBlock } from './utils/feedback.js';

const MODEL_GENERATE = 'gemini-2.5-flash';
const MODEL_SIMPLE = 'gemini-2.5-flash-lite';

const ROOT = process.cwd();

// Tokens por chamada (usageMetadata do Gemini), pra medir quanto custa cada ideia
// (SPEC 003 R2.5). pipeline.js abre a contagem no início de uma geração e fecha no fim.
let usageLedger = [];

function trackUsage(response) {
  const u = response?.usageMetadata;
  if (!u) return;
  usageLedger.push({ input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) });
}

export function startUsage() {
  usageLedger = [];
}

export function takeUsage() {
  const total = usageLedger.reduce((acc, u) => ({ input: acc.input + u.input, output: acc.output + u.output }), { input: 0, output: 0 });
  const out = { calls: usageLedger.length, ...total, total: total.input + total.output };
  usageLedger = [];
  return out;
}

// Soma contagens de várias gerações (usage do brief = mãe + derivadas).
export function sumUsage(list) {
  return (list || []).filter(Boolean).reduce(
    (acc, u) => ({ calls: acc.calls + (u.calls || 0), input: acc.input + (u.input || 0), output: acc.output + (u.output || 0), total: acc.total + (u.total || 0) }),
    { calls: 0, input: 0, output: 0, total: 0 },
  );
}

async function readDoc(rel) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) return '';
  return readFile(file, 'utf8');
}

async function loadSystemPrompt(tenant) {
  const template = await readDoc(tenant.prompts.system);
  const { docs } = tenant;
  const replacements = {
    '{{ICP}}': await readDoc(docs.icp),
    '{{POSICIONAMENTO}}': await readDoc(docs.posicionamento),
    '{{VOICE}}': await readDoc(docs.voice),
    '{{PILARES}}': await readDoc(docs.pilares),
    '{{DORES}}': await readDoc(docs.dores),
  };
  let prompt = template;
  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.replace(key, value);
  }
  return prompt;
}

async function loadChannelPrompt(channel, tenant) {
  return readDoc(`${tenant.prompts.channelsDir}/${channel}.md`);
}

async function loadPillarPrompt(pillar, tenant) {
  return readDoc(`${tenant.prompts.pillarsDir}/${pillar}.md`);
}

// Lê a linha "Engajamento: 312 likes, 47 salvamentos, ..." e soma os números
// como score bruto. Sem a linha, retorna 0 (seeds entram, mas atrás dos reais).
function parseEngagementScore(content) {
  const match = content.match(/engajamento\s*:?(.*)/i);
  if (!match) return 0;
  const nums = match[1].match(/\d+/g);
  if (!nums) return 0;
  return nums.reduce((sum, n) => sum + Number(n), 0);
}

async function loadExamplesFrom(rel) {
  const dir = path.join(ROOT, rel);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const examples = [];
  for (const f of files) {
    if ((f.endsWith('.md') || f.endsWith('.txt')) && f.toLowerCase() !== 'readme.md') {
      const content = await readFile(path.join(dir, f), 'utf8');
      examples.push({ name: f, content, score: parseEngagementScore(content) });
    }
  }
  return examples;
}

async function loadExamples(tenant) {
  const [high, low, published] = await Promise.all([
    loadExamplesFrom(tenant.examplesDir.high),
    loadExamplesFrom(tenant.examplesDir.low),
    getPublished(),
  ]);
  // Os que a coleta de métricas escolhe vêm dos posts no banco, não de arquivo (utils/examples.js).
  const auto = pickAutoExamples(published.filter(isRealPost), { windowDays: Number(process.env.METRICS_WINDOW_DAYS || 30) });
  high.push(...auto.high);
  low.push(...auto.low);
  // Maior engajamento primeiro; seeds (score 0) ficam no fim.
  high.sort((a, b) => b.score - a.score);
  return { high, low };
}

function buildFewShot({ high = [], low = [] }) {
  const sections = [];
  if (high.length > 0) {
    const blocks = high
      .slice(0, 6)
      .map((ex, i) => `### Exemplo ${i + 1} (${ex.name})\n${ex.content}`)
      .join('\n\n');
    sections.push(
      `## Exemplos de posts que performaram bem (referência de tom e estrutura — imite o tom, não copie o conteúdo)\n\n${blocks}`,
    );
  }
  if (low.length > 0) {
    const blocks = low
      .slice(0, 4)
      .map((ex, i) => `### Anti-exemplo ${i + 1} (${ex.name})\n${ex.content}`)
      .join('\n\n');
    sections.push(
      `## Anti-exemplos — posts que performaram MAL (NÃO repita esse tom, estrutura ou tipo de hook)\n\n${blocks}`,
    );
  }
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

// RAG opt-in (RAG_ENABLED=true): recupera trechos relevantes da base indexada.
// Best-effort — sem índice/sem chave/erro → string vazia (não quebra a geração).
async function retrieveKnowledge({ pillar, angle, context }) {
  if (process.env.RAG_ENABLED !== 'true') return '';
  try {
    const query = [pillar, angle, context].filter(Boolean).join(' ');
    const hits = await retrieve(query, { topK: 5 });
    if (!hits.length) return '';
    const blocks = hits.map(h => `- (${h.source}) ${h.text}`).join('\n\n');
    return `## Conhecimento recuperado (use o relevante; não invente)\n\n${blocks}`;
  } catch (e) {
    return '';
  }
}

export async function generatePost({ channel, pillar, angle, context, dryRun = false, tenant = resolveTenant() }) {
  if (!tenant.channels.includes(channel)) {
    throw new Error(`Canal inválido: ${channel}`);
  }

  // Só posts reais alimentam aprendizado/anti-repetição — dry-runs poluiriam.
  const published = (await getPublished()).filter(isRealPost);

  let chosenPillar = pillar;
  let chosenAngle = angle;
  if (!chosenPillar) ({ pillar: chosenPillar, angle: chosenAngle } = await chooseTopic(tenant, published));

  if (dryRun) {
    return mockGeneration({ channel, pillar: chosenPillar, angle: chosenAngle });
  }

  const recentHooks = extractRecentHooks(published);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada. Use DRY_RUN=true pra testar sem API.');
  }

  const client = new GoogleGenAI({ apiKey });

  const [systemBase, channelPrompt, pillarPrompt, examples] = await Promise.all([
    loadSystemPrompt(tenant),
    loadChannelPrompt(channel, tenant),
    loadPillarPrompt(chosenPillar, tenant),
    loadExamples(tenant),
  ]);

  const ragBlock = await retrieveKnowledge({ pillar: chosenPillar, angle: chosenAngle, context });
  // Regras de estilo aprendidas (reflection) + feedback recente do editor. Best-effort.
  // O de visual não entra aqui: vai pro prompt de imagem (getVisualGuidance).
  const [styleRules, recentFeedback] = await Promise.all([
    getActiveStyleRules(tenant.id, { channel }),
    getRecentFeedback(tenant.id, { channel }),
  ]);
  const reflectionBlock = buildReflectionBlock(styleRules);
  const feedbackBlock = buildFeedbackBlock(recentFeedback);

  const plat = tenant.platforms?.[channel];
  const platformLine = plat
    ? `Características da plataforma: tom ${plat.tone}; limite ${plat.maxChars} caracteres${plat.thread ? ' por tweet — use THREAD quando a ideia não couber em um' : ''}; formatos ${plat.formats.join(' / ')}.`
    : '';
  // Foto-pergunta: o modelo escolhe o croqui por id (o SVG sai do repo, nunca do modelo).
  const sketchLine = plat?.formats?.includes('pergunta')
    ? `Croquis disponíveis para o formato pergunta (use o id em "sketch"): ${croquisPromptList()}.`
    : '';
  const system = [
    systemBase,
    `## Canal alvo: ${channel}`,
    platformLine,
    sketchLine,
    channelPrompt,
    `## Pilar alvo: ${chosenPillar}`,
    pillarPrompt,
    ragBlock,
    reflectionBlock,
    feedbackBlock,
    buildFewShot(examples),
  ].filter(Boolean).join('\n\n---\n\n');

  // Instagram: bandit sobre todo o histórico (como sempre). LinkedIn: histórico do canal e
  // rodízio enquanto não há métrica (SPEC 005 R1).
  const targetFormat = channel === 'instagram'
    ? chooseNextFormat(published, {}, tenant.taxonomy)
    : channel === 'linkedin'
      ? chooseNextFormat(published, { channel, rotate: true, windowSize: 8 }, tenant.taxonomy)
      : null;
  const userMessage = buildUserMessage({ channel, pillar: chosenPillar, angle: chosenAngle, context, recentHooks, targetFormat });

  // Retry com backoff: o Gemini dá 503 "high demand" / 429 com frequência.
  // Caminho fatal da geração — não pode morrer numa sobrecarga transitória.
  const response = await withRetry(
    () => client.models.generateContent({
      model: MODEL_GENERATE,
      contents: userMessage,
      config: {
        systemInstruction: system,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    }),
    { tries: 4, baseMs: 2000, label: 'gemini-generate' },
  );

  trackUsage(response);
  const text = response.text || '';
  const parsed = parseJsonResponse(text);
  // Observabilidade: hash do system prompt + modelo → atribuição causal no DB
  // (qual prompt/modelo gerou o post que performou).
  const promptHash = createHash('sha256').update(system).digest('hex').slice(0, 16);
  // Persiste o template completo do prompt (atribuição: qual versão gerou o quê).
  if (usingDb()) {
    try {
      await getDb().from('prompt_versions').upsert({ hash: promptHash, tenant_id: tenant.id, role: 'system', template: system }, { onConflict: 'hash' });
    } catch (e) {
      console.error(`[generate] falha ao gravar prompt_version: ${e.message}`);
    }
  }
  return { ...parsed, channel, pillar: chosenPillar, angle: chosenAngle, model: MODEL_GENERATE, prompt_hash: promptHash };
}

// Pilar e ângulo pela rotação (bandit). index.js chama uma vez por rodada, pra todas as
// redes falarem da mesma ideia (SPEC 003 R1).
export async function chooseTopic(tenant = resolveTenant(), published = null) {
  const real = published || (await getPublished()).filter(isRealPost);
  const pillar = chooseNextPillar(real, 20, tenant.taxonomy);
  const angle = chooseNextAngle(pillar, real, 30, tenant.taxonomy);
  await snapshotBandit(real, tenant); // observabilidade da evolução do aprendizado
  return { pillar, angle };
}

// Snapshot dos posteriores Beta por pilar → bandit_snapshots (best-effort, só sob flag).
async function snapshotBandit(published, tenant) {
  if (!usingDb()) return;
  try {
    const post = pillarPosteriors(published, tenant.taxonomy);
    const rows = Object.entries(post).map(([arm, p]) => ({
      tenant_id: tenant.id, dimension: 'pillar', arm, alpha: p.alpha, beta: p.beta, n: p.n,
    }));
    if (rows.length) await getDb().from('bandit_snapshots').insert(rows);
  } catch (e) {
    console.error(`[generate] falha ao snapshot bandit: ${e.message}`);
  }
}

// Últimos ganchos publicados, pra instruir o modelo a não repetir tema/abertura.
function extractRecentHooks(published, limit = 12) {
  return published
    .slice(-limit)
    .map(item => item.post?.hook)
    .filter(Boolean);
}

function buildUserMessage({ channel, pillar, angle, context, recentHooks = [], targetFormat = null }) {
  const avoidBlock = recentHooks.length
    ? `Ganchos já usados recentemente (NÃO repita o tema nem a abertura destes):\n${recentHooks.map(h => `- ${h}`).join('\n')}`
    : '';
  const parts = [
    `Gere 3 variações de post pra ${channel} no pilar "${pillar}".`,
    angle ? `Ângulo sugerido: ${angle}.` : '',
    targetFormat ? `Formato preferido pra esta leva: ${targetFormat} (use se fizer sentido pro conteúdo; varie o feed).` : '',
    context ? `Contexto adicional: ${context}` : '',
    avoidBlock,
    '',
    'Retorne JSON puro conforme o formato definido no system prompt.',
  ].filter(Boolean);
  return parts.join('\n');
}

// Agente Crítico: tenta DERRUBAR cada variação (clichê, dor genérica, sem prova,
// fora de voz). Roda no modelo barato. Quem é "refuted" sai antes do judge —
// eleva o piso de qualidade sem custo relevante. Retorna verdicts ou null.
export async function critiqueVariations({ channel, pillar, variations, tenant = resolveTenant() }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !variations?.length) return null;

  const client = new GoogleGenAI({ apiKey });
  const list = variations.map(v => `Variação ${v.id}:\nHook: ${v.hook}\nCorpo: ${v.body}`).join('\n\n');
  const prompt = [
    `Você é um ${tenant.persona.critic}.`,
    'Pra CADA variação, tente DERRUBÁ-LA. Marque refuted=true se: o hook é clichê de LinkedIn,',
    'a dor é genérica (serviria pra qualquer SaaS), faz afirmação sem prova, ou foge da voz (seca, concreta).',
    'Seja exigente — mas NÃO marque tudo como refuted se houver opções claramente boas.',
    '',
    list,
    '',
    'Responda só JSON: {"verdicts":[{"id":<número>,"refuted":<bool>,"flags":["motivo curto"]}]}',
  ].join('\n');

  try {
    const response = await client.models.generateContent({
      model: MODEL_SIMPLE,
      contents: prompt,
      config: { maxOutputTokens: 600, responseMimeType: 'application/json' },
    });
    trackUsage(response);
    const parsed = parseJsonResponse(response.text || '');
    return Array.isArray(parsed.verdicts) ? parsed.verdicts : null;
  } catch (e) {
    return null;
  }
}

// Agrega as dimensões do judge em total ponderado e escolhe o vencedor. Pura
// (testável). Pesos: hook e especificidade pesam mais (o que para o scroll em B2B).
export function judgeFromScores(scores, variations) {
  const W = { hook_stop: 3, especificidade: 3, fit_voz: 2, prova: 2 };
  const valid = (scores || []).filter(s => variations.some(v => v.id === s.id));
  if (!valid.length) return null;
  const ranked = valid
    .map(s => ({
      id: s.id,
      total: (s.hook_stop || 0) * W.hook_stop + (s.especificidade || 0) * W.especificidade
           + (s.fit_voz || 0) * W.fit_voz + (s.prova || 0) * W.prova,
      expected_engagement: s.expected_engagement ?? null,
      dimensions: { hook_stop: s.hook_stop, especificidade: s.especificidade, fit_voz: s.fit_voz, prova: s.prova },
    }))
    .sort((a, b) => b.total - a.total);
  const top = ranked[0];
  const d = top.dimensions;
  const reason = `score ${top.total} (hook ${d.hook_stop}, espec ${d.especificidade}, voz ${d.fit_voz}, prova ${d.prova})`;
  return { chosenId: top.id, reason, scores: ranked };
}

// LLM-as-judge MULTIDIMENSIONAL: nota cada variação em 4 dimensões + previsão de
// engajamento (pra calibração: previsto vs real depois). Retorna
// { chosenId, reason, scores } ou null se a API falhar/indisponível.
export async function judgeVariations({ channel, pillar, variations, tenant = resolveTenant() }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !variations?.length) return null;

  const client = new GoogleGenAI({ apiKey });
  const list = variations.map(v => `Variação ${v.id}:\nHook: ${v.hook}\nCorpo: ${v.body}`).join('\n\n');
  const prompt = [
    `Você é ${tenant.persona.judge}.`,
    `Avalie CADA variação pra ${channel}, pilar "${pillar}", em 4 dimensões (0-10):`,
    `- hook_stop: o hook para o scroll?`,
    `- especificidade: a dor é concreta e específica (não genérica)?`,
    `- fit_voz: tom seco, direto, zero buzzword?`,
    `- prova: tem evidência/número/cena real (não só afirmação)?`,
    `Dê também expected_engagement (0-100): sua previsão de quão bem vai engajar.`,
    '',
    list,
    '',
    'Responda só JSON: {"scores":[{"id":<n>,"hook_stop":<0-10>,"especificidade":<0-10>,"fit_voz":<0-10>,"prova":<0-10>,"expected_engagement":<0-100>}]}',
  ].join('\n');

  try {
    const response = await client.models.generateContent({
      model: MODEL_SIMPLE,
      contents: prompt,
      config: { maxOutputTokens: 600, responseMimeType: 'application/json' },
    });
    trackUsage(response);
    const parsed = parseJsonResponse(response.text || '');
    return judgeFromScores(parsed.scores, variations);
  } catch (e) {
    return null;
  }
}

// Guardrails programáticos — flags que NÃO deviam passar. As listas vêm do tenant
// (tenant.guardrails); sem tenant explícito, usa o default (Pilar).
export function checkGuardrails(variation, { pillar, tenant = resolveTenant() } = {}) {
  const { buzzwords, foraIcp, foraRecorte } = tenant.guardrails;
  const text = `${variation?.hook || ''}\n${variation?.body || ''}`.toLowerCase();
  const flags = [];
  for (const w of buzzwords) if (text.includes(w)) flags.push(`buzzword:${w}`);
  for (const w of foraIcp) if (text.includes(w)) flags.push(`fora-icp:${w}`);
  for (const w of foraRecorte) if (text.includes(w)) flags.push(`fora-recorte:${w}`);
  if (pillar === 'prova' && /\d/.test(text)) flags.push('prova-com-numero:verificar-fonte');
  if (variation?.format === 'pergunta') {
    const question = String(variation.question || '').trim();
    if (!question) flags.push('pergunta-ausente');
    else {
      if (question.split(/\s+/).length > 12) flags.push('pergunta-longa:max-12-palavras');
      if (!question.endsWith('?')) flags.push('pergunta-sem-interrogacao');
    }
  }
  return { clean: flags.length === 0, flags };
}

// Etapa de auto-edição: um "editor" reescreve o post aplicando o checklist de voz.
// Best-effort — devolve a variação original se a API falhar. Não inventa fatos.
export async function polishPost({ channel, pillar, variation, tenant = resolveTenant() }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !variation) return variation;
  const client = new GoogleGenAI({ apiKey });

  const checklist = tenant.voiceChecklist.map(rule => `- ${rule}`).join('\n');
  const prompt = [
    `Você é ${tenant.persona.editor}.`,
    'Revise o post abaixo aplicando o checklist de voz, SEM inventar fato novo:',
    checklist,
    '',
    `Canal: ${channel} | Pilar: ${pillar}`,
    `Hook: ${variation.hook}`,
    `Corpo: ${variation.body}`,
    '',
    'Devolva só JSON: {"hook":"...","body":"..."} — mesmo idioma e formato, só melhor.',
  ].join('\n');

  try {
    const response = await client.models.generateContent({
      model: MODEL_SIMPLE,
      contents: prompt,
      config: { maxOutputTokens: 1500, responseMimeType: 'application/json' },
    });
    trackUsage(response);
    const parsed = parseJsonResponse(response.text || '');
    if (parsed.hook && parsed.body) return { ...variation, hook: parsed.hook, body: parsed.body };
    return variation;
  } catch (e) {
    return variation;
  }
}

// Reaproveitamento (SPEC 003 R2.2): adapta o texto aprovado do conteúdo-mãe pra outra rede
// numa chamada só, no modelo barato. Sem 3 variações, crítico, judge nem polish: a ideia,
// a voz e a prova já passaram por eles no canal-mãe. Slides do carrossel ficam iguais.
export function buildAdaptPrompt({ fromChannel, toChannel, pillar, variation, kind, channelPrompt = '', rules = [], tenant }) {
  const plat = tenant.platforms?.[toChannel];
  const limits = plat
    ? `Rede alvo: ${toChannel} (tom ${plat.tone}; limite ${plat.maxChars} caracteres${plat.thread ? ' por tweet; se não couber em um, escreva a thread com os tweets separados por linha em branco' : ''}).`
    : `Rede alvo: ${toChannel}.`;
  const shape = kind === 'carousel'
    ? 'O post vai com os MESMOS slides do original; escreva só a legenda que acompanha os slides.'
    : kind === 'pergunta'
      ? 'O post vai com a MESMA imagem (uma pergunta sobre um croqui); escreva o texto que acompanha a imagem.'
      : '';
  return [
    [
      `Você adapta um post já aprovado de ${fromChannel} para ${toChannel}, sem perder a ideia, a prova e a voz.`,
      'Não invente fato, número ou cliente novo. Corte o que não cabe; reescreva para o jeito da rede.',
      limits,
      shape,
    ].filter(Boolean).join('\n'),
    channelPrompt ? `## Regras da rede\n\n${channelPrompt}` : '',
    rules.length ? `## Regras aprendidas (siga à risca)\n\n${rules.map(r => `- ${r}`).join('\n')}` : '',
    `Pilar: ${pillar}\nHook original: ${variation.hook}\nCorpo original:\n${variation.body}`,
    'Devolva só JSON: {"hook":"...","body":"...","hashtags":["..."]}',
  ].filter(Boolean).join('\n\n');
}

export async function adaptPost({ fromChannel, toChannel, pillar, angle, variation, kind, dryRun = false, tenant = resolveTenant() }) {
  const base = { id: variation.id, format: kind === 'carousel' ? 'carousel' : kind === 'pergunta' ? 'pergunta' : 'single' };
  if (kind === 'carousel') Object.assign(base, { slides: variation.slides, slideUrls: variation.slideUrls });
  if (kind === 'pergunta') Object.assign(base, { question: variation.question, sketch: variation.sketch });

  if (dryRun) {
    return { channel: toChannel, pillar, angle, variations: [{ ...base, hook: `[MOCK reuse ${toChannel}] ${variation.hook}`, body: variation.body, hashtags: [] }] };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada. Use DRY_RUN=true pra testar sem API.');

  const [channelPrompt, rules] = await Promise.all([
    loadChannelPrompt(toChannel, tenant),
    getActiveStyleRules(tenant.id, { channel: toChannel }),
  ]);
  const prompt = buildAdaptPrompt({ fromChannel, toChannel, pillar, variation, kind, channelPrompt, rules, tenant });
  const client = new GoogleGenAI({ apiKey });
  const response = await withRetry(
    () => client.models.generateContent({
      model: MODEL_SIMPLE,
      contents: prompt,
      config: { maxOutputTokens: 1500, responseMimeType: 'application/json' },
    }),
    { tries: 3, baseMs: 2000, label: 'gemini-adapt' },
  );
  trackUsage(response);
  const parsed = parseJsonResponse(response.text || '');
  if (!parsed.body) throw new Error(`Adaptação ${fromChannel}→${toChannel} sem corpo`);
  return {
    channel: toChannel,
    pillar,
    angle,
    variations: [{ ...base, hook: parsed.hook || variation.hook, body: parsed.body, hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [] }],
    model: MODEL_SIMPLE,
    prompt_hash: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
  };
}

// Monta a legenda final = corpo + hashtags (campo estruturado). Mantém o body
// limpo (sem # grudada) e dá controle/consistência sobre as tags. Pura (testável).
export function composeCaption(variation) {
  const body = (variation?.body || '').trim();
  const tags = Array.isArray(variation?.hashtags) ? variation.hashtags : [];
  const norm = tags
    .map(t => String(t).trim())
    .filter(Boolean)
    .map(t => (t.startsWith('#') ? t : `#${t}`));
  return norm.length ? `${body}\n\n${norm.join(' ')}` : body;
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Falha ao parsear resposta do Gemini: ${e.message}\nRaw: ${text.slice(0, 500)}`);
  }
}

function mockGeneration({ channel, pillar, angle }) {
  const isCarousel = pillar === 'dica' && channel === 'instagram';
  const isPergunta = pillar === 'dor' && channel === 'instagram';
  return {
    channel,
    pillar,
    angle,
    variations: [
      {
        id: 1,
        hook: `[MOCK ${channel}/${pillar} #1] Você já mandou Rev04 quando devia ser Rev06?`,
        body: `[MOCK] Variação direta sobre dor ${angle || 'genérica'}.\n\nDetalhe concreto.\nImplicação.\n\nPergunta?`,
        format: isCarousel ? 'carousel' : 'single',
        slides: isCarousel ? ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5'] : undefined,
      },
      isPergunta
        ? {
          id: 2,
          hook: `[MOCK ${channel}/${pillar} #2] Você cobra a revisão 3 ou faz de graça?`,
          body: `[MOCK] Foto-pergunta.\n\nContexto curto.\nResponde aqui embaixo.`,
          format: 'pergunta',
          question: 'Você cobra a revisão 3 ou faz de graça?',
          sketch: 'nuvem-revisao',
        }
        : {
          id: 2,
          hook: `[MOCK ${channel}/${pillar} #2] Cena: 23h, escritório vazio, planilha aberta.`,
          body: `[MOCK] Variação narrativa.\n\nCena.\nVirada.\nFechamento.`,
          format: 'single',
        },
      {
        id: 3,
        hook: `[MOCK ${channel}/${pillar} #3] 5 sinais que você tá refém da planilha`,
        body: `[MOCK] Variação em lista.\n\n1. Item\n2. Item\n3. Item\n4. Item\n5. Item`,
        format: isCarousel ? 'carousel' : 'single',
        slides: isCarousel ? ['Hook', '1', '2', '3', '4', '5', 'CTA'] : undefined,
      },
    ],
    meta: {
      pillar,
      angle: angle || 'mock',
      reasoning: '[MOCK] Geração sem chamada API. Use GEMINI_API_KEY pra geração real.',
    },
  };
}

export const _internal = { parseJsonResponse, buildFewShot, mockGeneration, MODEL_GENERATE, MODEL_SIMPLE };
