import { describe, it, expect } from 'vitest';
import { vertexStudioModel } from '../platform/src/lib/studio/vertex-model.ts';

function fakeClient() {
  const calls = [];
  return {
    calls,
    config: {},
    async generateText(input) {
      calls.push({ kind: 'text', ...input });
      return { text: 'resposta', inputTokens: 1, outputTokens: 1, modelVersion: null, durationMs: 1, costUsd: 0.02 };
    },
    async generateImage(input) {
      calls.push({ kind: 'image', ...input });
      return { png: Buffer.from('png'), inputTokens: 1, outputTokens: 1, modelVersion: null, durationMs: 1, costUsd: 0.134 };
    },
  };
}

describe('modelo do estúdio sobre o Vertex', () => {
  it('manda labels da fatura (conta, pedido, etapa studio-) e o modelo do papel', async () => {
    const client = fakeClient();
    const model = vertexStudioModel(client, { tenant: 'acme', brief: 'b1' });
    await model.text({ model: 'smart', prompt: 'p', step: 'critico', thinking: 'low', json: true });
    await model.text({ model: 'fast', prompt: 'p', step: 'designer' });
    expect(client.calls[0]).toMatchObject({ kind: 'text', model: 'gemini-3.1-pro-preview', thinking: 'low', json: true, labels: { tenant: 'acme', brief: 'b1', step: 'studio-critico' } });
    expect(client.calls[1]).toMatchObject({ model: 'gemini-3-flash-preview', labels: { step: 'studio-designer' } });
  });

  it('imagem: o modelo vem da qualidade, a proporção vira 4:5 ou 1:1, e o custo soma por etapa', async () => {
    const client = fakeClient();
    const model = vertexStudioModel(client, { tenant: 'acme', brief: 'b1' });
    await model.image({ prompt: 'p', aspect: '16:9', quality: 'alta', step: 'imagem' });
    await model.image({ prompt: 'p', aspect: '1:1', quality: 'padrao', step: 'imagem' });
    expect(client.calls[0]).toMatchObject({ kind: 'image', model: 'gemini-3-pro-image', aspect: '4:5' });
    expect(client.calls[1]).toMatchObject({ model: 'gemini-3.1-flash-image', aspect: '1:1' });
    await model.text({ model: 'smart', prompt: 'p', step: 'redator' });
    expect(model.costUsd).toBeCloseTo(0.134 * 2 + 0.02, 6);
    expect(model.costByStep.imagem).toMatchObject({ calls: 2 });
    expect(model.costByStep.redator).toMatchObject({ calls: 1 });
  });
});
