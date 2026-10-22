import { describe, it, expect } from 'vitest';
import { vertexClient, cleanLabels, parseModelJson, textCost, imageCost, vertexConfig } from '../platform/src/lib/vertex.ts';

const cfg = { project: 'ekoai-test', location: 'global', textModel: 'gemini-2.5-flash', imageModel: 'gemini-3.1-flash-image' };

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    const next = responses.shift();
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  };
  return { impl, calls };
}

describe('cliente do Vertex', () => {
  it('chama o endpoint global com ADC, labels limpos e devolve JSON, tokens e custo', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { candidates: [{ content: { parts: [{ text: '```json\n{"title":"Oi"}\n```' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 }, modelVersion: 'gemini-2.5-flash-001' } }]);
    const client = vertexClient({ config: cfg, fetchImpl: impl, token: async () => 'tok' });
    const out = await client.generateJson({ prompt: 'p', labels: { Tenant: 'Acme Ltda', step: 'writer' } });
    expect(out.json).toEqual({ title: 'Oi' });
    expect(out.costUsd).toBeCloseTo(0.0003 + 0.0005, 8);
    expect(out.modelVersion).toBe('gemini-2.5-flash-001');
    expect(calls[0].url).toBe('https://aiplatform.googleapis.com/v1/projects/ekoai-test/locations/global/publishers/google/models/gemini-2.5-flash:generateContent');
    expect(calls[0].auth).toBe('Bearer tok');
    expect(calls[0].body.labels).toEqual({ tenant: 'acme_ltda', step: 'writer' });
    expect(calls[0].body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('imagem: devolve o PNG do inlineData e cobra os tokens de imagem', async () => {
    const png = Buffer.from('png-bytes').toString('base64');
    const { impl, calls } = fakeFetch([{ status: 200, body: { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: png } }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 1120 } } }]);
    const client = vertexClient({ config: cfg, fetchImpl: impl, token: async () => 'tok' });
    const out = await client.generateImage({ prompt: 'a cake', aspect: '4:5', labels: { tenant: 'a' } });
    expect(out.png.toString()).toBe('png-bytes');
    expect(out.costUsd).toBeCloseTo(0.0672 + 0.000025, 6);
    expect(calls[0].body.generationConfig.imageConfig.aspectRatio).toBe('4:5');
    expect(calls[0].url).toContain('gemini-3.1-flash-image:generateContent');
  });

  it('429 e 503 tentam de novo com espera crescente; depois a falha diz o modelo e o motivo', async () => {
    const waits = [];
    const sleep = async (ms) => void waits.push(ms);
    const { impl } = fakeFetch([{ status: 429, body: { error: { message: 'quota' } } }, { status: 503, body: {} }, { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] } }]);
    const client = vertexClient({ config: cfg, fetchImpl: impl, token: async () => 'tok', sleep });
    expect((await client.generateJson({ prompt: 'p', labels: {} })).json).toEqual({ a: 1 });
    expect(waits).toEqual([5000, 15000]);

    const bad = fakeFetch([{ status: 429, body: {} }, { status: 429, body: {} }, { status: 429, body: { error: { message: 'Quota exceeded for aiplatform' } } }]);
    const client2 = vertexClient({ config: cfg, fetchImpl: bad.impl, token: async () => 'tok', sleep });
    await expect(client2.generateJson({ prompt: 'p', labels: {} })).rejects.toThrow(/Vertex AI 429 em gemini-2.5-flash: Quota exceeded/);
    const forbidden = fakeFetch([{ status: 403, body: { error: { message: 'Permission denied' } } }]);
    await expect(vertexClient({ config: cfg, fetchImpl: forbidden.impl, token: async () => 'tok', sleep }).generateJson({ prompt: 'p', labels: {} })).rejects.toThrow(/403/);
  });

  it('resposta sem conteúdo ou sem imagem falha com o motivo do modelo', async () => {
    const empty = fakeFetch([{ status: 200, body: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } }]);
    await expect(vertexClient({ config: cfg, fetchImpl: empty.impl, token: async () => 'tok' }).generateJson({ prompt: 'p', labels: {} })).rejects.toThrow(/SAFETY/);
    const noImg = fakeFetch([{ status: 200, body: { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [{ text: 'não' }] } }] } }]);
    await expect(vertexClient({ config: cfg, fetchImpl: noImg.impl, token: async () => 'tok' }).generateImage({ prompt: 'p', aspect: '1:1', labels: {} })).rejects.toThrow(/IMAGE_SAFETY/);
  });

  it('texto: desliga o raciocínio e diz quando a resposta veio cortada pelo limite de tokens', async () => {
    const cut = fakeFetch([{ status: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"caption":"Oi, tudo' }] } }] } }]);
    await expect(vertexClient({ config: cfg, fetchImpl: cut.impl, token: async () => 'tok' }).generateJson({ prompt: 'p', labels: {} })).rejects.toThrow(/cortada/);
    expect(cut.calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(cut.calls[0].body.generationConfig.maxOutputTokens).toBe(4096);
  });

  it('helpers: JSON com texto em volta, labels, preços e configuração', () => {
    expect(parseModelJson('Aqui está: {"x":1} obrigado')).toEqual({ x: 1 });
    expect(() => parseModelJson('nada')).toThrow(/não é JSON/);
    expect(cleanLabels({ 'Brief Id': 'A-B.c', x: '' })).toEqual({ brief_id: 'a-b_c', x: '' });
    expect(textCost(1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(imageCost(0, 1120)).toBeCloseTo(0.0672, 6);
    expect(vertexConfig({ VERTEX_PROJECT_ID: 'p' })).toEqual({ project: 'p', location: 'global', textModel: 'gemini-2.5-flash', imageModel: 'gemini-3.1-flash-image' });
    expect(vertexConfig({ GOOGLE_CLOUD_PROJECT: 'g', VERTEX_LOCATION: 'us-central1' }).location).toBe('us-central1');
    expect(() => vertexConfig({})).toThrow(/VERTEX_PROJECT_ID/);
  });
});
