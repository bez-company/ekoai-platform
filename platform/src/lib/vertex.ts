// vertex.ts: chamadas ao Vertex AI por REST, com a credencial da conta de serviço do Cloud Run
// (ADC) e sem chave no repositório nem no navegador (SPEC 012, decisão 6). Toda chamada leva labels
// (conta e etapa) para a fatura do provedor e devolve tokens, versão do modelo e custo estimado.
// Erro transitório (429, 503) tenta de novo até 2 vezes, com espera crescente; depois, erro claro.

import { GoogleAuth } from 'google-auth-library';

export type VertexConfig = { project: string; location: string; textModel: string; imageModel: string };

export type TextResult = { json: unknown; raw: string; inputTokens: number; outputTokens: number; modelVersion: string | null; durationMs: number; costUsd: number };
export type ImageResult = { png: Buffer; inputTokens: number; outputTokens: number; modelVersion: string | null; durationMs: number; costUsd: number };

export type Labels = Record<string, string>;

export interface ModelClient {
  readonly config: VertexConfig;
  // `image`: foto que o modelo de texto olha junto do pedido (visão), como no banco de imagens.
  generateJson(input: { prompt: string; labels: Labels; maxOutputTokens?: number; temperature?: number; image?: { bytes: Uint8Array; mimeType: string } }): Promise<TextResult>;
  // `reference`: foto da empresa que o modelo usa como inspiração (BEZ-237, uso "inspiração").
  generateImage(input: { prompt: string; aspect: '1:1' | '4:5'; labels: Labels; reference?: { bytes: Uint8Array; mimeType: string } }): Promise<ImageResult>;
}

// Preço de lista (catálogo do Cloud Billing, endpoint global, lido em 21/10/2026), em US$ por
// milhão de tokens. Serve para a estimativa por chamada; a fatura real é a do provedor.
export const PRICING = { textIn: 0.3, textOut: 2.5, imageIn: 0.5, imageOut: 60 };

// Imagem: o preço muda de modelo para modelo (torneio de 22/10/2026, BEZ-220). Modelo fora da lista
// cai no preço do 3.1 Flash, o mais caro dos candidatos que importam, para a estimativa nunca ficar abaixo do real.
export const IMAGE_PRICING: Record<string, { imageIn: number; imageOut: number }> = {
  'gemini-3.1-flash-image': { imageIn: 0.5, imageOut: 60 },
  'gemini-3.1-flash-lite-image': { imageIn: 0.25, imageOut: 30 },
  'gemini-nano-banana-2.1': { imageIn: 1.5, imageOut: 30 },
  'gemini-2.5-flash-image': { imageIn: 0.3, imageOut: 30 },
  'gemini-3-pro-image': { imageIn: 2, imageOut: 120 },
};

export function textCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICING.textIn + outputTokens * PRICING.textOut) / 1e6;
}

export function imageCost(inputTokens: number, outputTokens: number, model?: string): number {
  const price = (model && IMAGE_PRICING[model]) || { imageIn: PRICING.imageIn, imageOut: PRICING.imageOut };
  return (inputTokens * price.imageIn + outputTokens * price.imageOut) / 1e6;
}

export function vertexConfig(env: Record<string, string | undefined> = process.env): VertexConfig {
  const project = env.VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error('VERTEX_PROJECT_ID é obrigatória (o projeto do Google Cloud do ambiente).');
  return {
    project,
    location: env.VERTEX_LOCATION || 'global',
    textModel: env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash',
    imageModel: env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image',
  };
}

// Labels do Vertex: minúsculas, até 63 caracteres, só letra, número, hífen e sublinhado.
export function cleanLabels(labels: Labels): Labels {
  const out: Labels = {};
  for (const [k, v] of Object.entries(labels)) {
    const key = k.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 63);
    const value = String(v).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 63);
    if (key) out[key] = value;
  }
  return out;
}

// O JSON que o modelo devolve, limpo de cerca de código e com o objeto extraído se vier texto em volta.
export function parseModelJson(text: string): unknown {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('O modelo devolveu algo que não é JSON.');
    return JSON.parse(match[0]);
  }
}

let auth: GoogleAuth | null = null;
async function adcToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Sem credencial para o Vertex AI (ADC).');
  return token.token;
}

type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

const RETRY_WAITS_MS = [5_000, 15_000];

export function vertexClient(options: { config?: VertexConfig; fetchImpl?: Fetch; token?: () => Promise<string>; sleep?: Sleep } = {}): ModelClient {
  const config = options.config ?? vertexConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token ?? adcToken;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const host = config.location === 'global' ? 'aiplatform.googleapis.com' : `${config.location}-aiplatform.googleapis.com`;
  const base = `https://${host}/v1/projects/${config.project}/locations/${config.location}/publishers/google/models`;

  async function call(model: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetchImpl(`${base}/${model}:generateContent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'x-goog-user-project': config.project, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (res.ok) return data;
      if ((res.status === 429 || res.status === 503) && attempt < RETRY_WAITS_MS.length) {
        await sleep(RETRY_WAITS_MS[attempt]);
        continue;
      }
      const reason = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 200) : 'sem detalhe';
      throw new Error(`Vertex AI ${res.status} em ${model}: ${reason}`);
    }
  }

  return {
    config,
    async generateJson({ prompt, labels, maxOutputTokens = 4096, temperature = 0.7, image }) {
      const started = Date.now();
      const parts: Record<string, unknown>[] = [{ text: prompt }];
      if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: Buffer.from(image.bytes).toString('base64') } });
      const data = await call(config.textModel, {
        contents: [{ role: 'user', parts }],
        // thinkingBudget 0: no 2.5 Flash o raciocínio sai do mesmo teto de tokens e corta o JSON no meio.
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens, temperature, thinkingConfig: { thinkingBudget: 0 } },
        labels: cleanLabels(labels),
      });
      const raw: string = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      if (!raw) throw new Error(`O modelo de texto não devolveu conteúdo (${data.candidates?.[0]?.finishReason ?? 'sem candidato'}).`);
      const inputTokens = Number(data.usageMetadata?.promptTokenCount ?? 0);
      const outputTokens = Number(data.usageMetadata?.candidatesTokenCount ?? 0);
      const finishReason = data.candidates?.[0]?.finishReason;
      let json: unknown;
      try {
        json = parseModelJson(raw);
      } catch (e) {
        if (finishReason === 'MAX_TOKENS') throw new Error('A resposta do modelo veio cortada (limite de tokens).');
        throw e;
      }
      return { json, raw, inputTokens, outputTokens, modelVersion: data.modelVersion ?? null, durationMs: Date.now() - started, costUsd: textCost(inputTokens, outputTokens) };
    },
    async generateImage({ prompt, aspect, labels, reference }) {
      const started = Date.now();
      const parts: Record<string, unknown>[] = [{ text: prompt }];
      if (reference) parts.push({ inlineData: { mimeType: reference.mimeType, data: Buffer.from(reference.bytes).toString('base64') } });
      const data = await call(config.imageModel, {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } },
        labels: cleanLabels(labels),
      });
      const part = data.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
      if (!part) throw new Error(`O modelo de imagem não devolveu imagem (${data.candidates?.[0]?.finishReason ?? 'sem candidato'}).`);
      const inputTokens = Number(data.usageMetadata?.promptTokenCount ?? 0);
      const outputTokens = Number(data.usageMetadata?.candidatesTokenCount ?? 0);
      return { png: Buffer.from(part.inlineData.data, 'base64'), inputTokens, outputTokens, modelVersion: data.modelVersion ?? null, durationMs: Date.now() - started, costUsd: imageCost(inputTokens, outputTokens, config.imageModel) };
    },
  };
}
