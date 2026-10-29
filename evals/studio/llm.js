// llm.js: chamadas ao Vertex por REST com o token do gcloud (o ADC da máquina expira; a conta do gcloud não).
// Texto aceita várias imagens de entrada (o crítico e o designer olham o PNG) e devolve texto livre: o HTML do
// designer não passa por JSON. Toda chamada soma tokens e custo estimado em `ledger`, para o relatório do eval.

import { execFileSync } from 'node:child_process';
import { assertBudget, chargeEval, evalLabels, evalProject } from '../guard.js';

// US$ por milhão de tokens (lista de 28/10/2026). Estimativa: a fatura real é a do provedor.
export const PRICE = {
  'gemini-3.1-pro-preview': { in: 2, out: 12 },
  'gemini-3-flash-preview': { in: 0.5, out: 3 },
  'gemini-3-pro-image': { in: 2, out: 120 },
  'gemini-3.1-flash-image': { in: 0.5, out: 60 },
};

export const MODELS = {
  smart: process.env.STUDIO_SMART_MODEL || 'gemini-3.1-pro-preview',
  fast: process.env.STUDIO_FAST_MODEL || 'gemini-3-flash-preview',
  image: process.env.STUDIO_IMAGE_MODEL || 'gemini-3-pro-image',
};

const modelsUrl = (project) => `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models`;

let cached = null;
// Descarta o token em cache (o gcloud invalida a credencial no meio de uma rodada longa; a próxima chamada pede outro).
export function resetToken() {
  cached = null;
}

export function token() {
  if (cached && Date.now() - cached.at < 20 * 60_000) return cached.value;
  const value = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  cached = { value, at: Date.now() };
  return value;
}

const WAITS_MS = [4_000, 12_000, 30_000, 60_000];
const CALL_TIMEOUT_MS = 12 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(model, body) {
  // O projeto sai do guard a cada chamada: ekoai-staging por padrão, ekoai-prod só com EVAL_ALLOW_PROD=1 (BEZ-458).
  const project = evalProject();
  const base = modelsUrl(project);
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(`${base}/${model}:generateContent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token()}`, 'x-goog-user-project': project, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt < WAITS_MS.length) {
        await sleep(WAITS_MS[attempt]);
        continue;
      }
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    // 401 no meio de uma rodada longa: a credencial foi invalidada; pede outra ao gcloud e repete.
    if (res.status === 401 && attempt < WAITS_MS.length) {
      cached = null;
      await sleep(2_000);
      continue;
    }
    if ([429, 500, 503].includes(res.status) && attempt < WAITS_MS.length) {
      await sleep(WAITS_MS[attempt]);
      continue;
    }
    throw new Error(`Vertex ${res.status} em ${model}: ${String(data?.error?.message ?? 'sem detalhe').slice(0, 240)}`);
  }
}

// Custo acumulado por etapa (`step`), para saber quanto cada agente pesa no post.
export function newLedger() {
  const steps = {};
  return {
    steps,
    add(step, usd, tokens, ms = 0) {
      const s = (steps[step] ??= { calls: 0, usd: 0, tokens: 0, ms: 0 });
      s.calls += 1;
      s.usd += usd;
      s.tokens += tokens;
      s.ms += ms;
    },
    get total() {
      return Object.values(steps).reduce((sum, s) => sum + s.usd, 0);
    },
  };
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// Texto: `images` = [{ bytes, label? }] entram depois do prompt, na ordem. `json: true` pede application/json.
// `thinking`: 'low' | 'high' limita o raciocínio do modelo (mais barato e rápido nos passos de checagem).
export async function ask({ model = MODELS.smart, prompt, images = [], json = false, temperature = 0.8, maxOutputTokens = 32768, thinking, ledger, step = 'ask' }) {
  const started = Date.now();
  const parts = [{ text: prompt }];
  for (const img of images) {
    if (img.label) parts.push({ text: img.label });
    parts.push({ inlineData: { mimeType: img.mimeType ?? 'image/png', data: b64(img.bytes) } });
  }
  assertBudget();
  const generationConfig = { temperature, maxOutputTokens, ...(json ? { responseMimeType: 'application/json' } : {}), ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) };
  const data = await call(model, { contents: [{ role: 'user', parts }], generationConfig, labels: evalLabels(`studio-${step}`, { run: process.env.EVAL_RUN_ID }) });
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  const inTok = Number(data.usageMetadata?.promptTokenCount ?? 0);
  const outTok = Number(data.usageMetadata?.candidatesTokenCount ?? 0) + Number(data.usageMetadata?.thoughtsTokenCount ?? 0);
  const price = PRICE[model] ?? PRICE['gemini-3.1-pro-preview'];
  const usd = (inTok * price.in + outTok * price.out) / 1e6;
  ledger?.add(step, usd, inTok + outTok, Date.now() - started);
  chargeEval(usd);
  if (!text) throw new Error(`${model} não devolveu texto (${cand?.finishReason ?? 'sem candidato'}).`);
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error(`${model} cortou a resposta no limite de tokens (${step}).`);
  return { text, usd };
}

// JSON: tenta de novo uma vez se a resposta vier quebrada.
export async function askJson(opts) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { text } = await ask({ ...opts, json: true, temperature: attempt === 1 ? opts.temperature ?? 0.8 : 0.4 });
      return parseJson(text);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function parseJson(text) {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let value;
  try {
    value = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (!match) throw new Error('A resposta não é JSON.');
    value = JSON.parse(match[0]);
  }
  // O modelo às vezes embrulha o objeto num array de um item.
  return Array.isArray(value) && value.length === 1 && typeof value[0] === 'object' ? value[0] : value;
}

// Imagem: devolve { png, usd }. `refs` = [{ bytes, mimeType }] entram como referência visual.
export async function makeImage({ model = MODELS.image, prompt, aspect = '4:5', refs = [], ledger, step = 'image' }) {
  const started = Date.now();
  assertBudget();
  const parts = [{ text: prompt }, ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType ?? 'image/png', data: b64(r.bytes) } }))];
  const data = await call(model, { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } }, labels: evalLabels(`studio-${step}`, { run: process.env.EVAL_RUN_ID }) });
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error(`${model} não devolveu imagem (${data.candidates?.[0]?.finishReason ?? 'sem candidato'}).`);
  const inTok = Number(data.usageMetadata?.promptTokenCount ?? 0);
  const outTok = Number(data.usageMetadata?.candidatesTokenCount ?? 0);
  const price = PRICE[model] ?? PRICE['gemini-3-pro-image'];
  const usd = (inTok * price.in + outTok * price.out) / 1e6;
  ledger?.add(step, usd, inTok + outTok, Date.now() - started);
  chargeEval(usd);
  return { png: Buffer.from(part.inlineData.data, 'base64'), usd };
}
