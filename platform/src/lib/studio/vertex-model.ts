// vertex-model.ts: o StudioModel de produção, em cima do ModelClient do Vertex (vertex.ts). Cada chamada leva os labels da fatura do
// provedor (conta, pedido e etapa `studio-<agente>`) e soma o custo por etapa, que o pipeline compara com o teto do nível.

import type { Labels, ModelClient } from '../vertex';
import { STUDIO_MODELS } from './config';
import { IMAGE_QUALITY } from './levels';
import type { ImageCall, StudioModel, TextCall } from './pipeline';

export function vertexStudioModel(client: ModelClient, ctx: { tenant: string; brief: string }): StudioModel {
  let total = 0;
  const steps: Record<string, { calls: number; usd: number }> = {};
  const add = (step: string, usd: number) => {
    total += usd;
    const s = (steps[step] ??= { calls: 0, usd: 0 });
    s.calls += 1;
    s.usd += usd;
  };
  const labels = (step: string): Labels => ({ tenant: ctx.tenant, brief: ctx.brief, step: `studio-${step}` });

  return {
    get costUsd() {
      return total;
    },
    get costByStep() {
      return steps;
    },
    async text(call: TextCall) {
      const out = await client.generateText({
        prompt: call.prompt,
        labels: labels(call.step),
        model: STUDIO_MODELS[call.model],
        images: call.images?.map((i) => ({ bytes: i.bytes, label: i.label })),
        thinking: call.thinking,
        temperature: call.temperature,
        json: call.json,
      });
      add(call.step, out.costUsd);
      return out.text;
    },
    async image(call: ImageCall) {
      const out = await client.generateImage({ prompt: call.prompt, aspect: call.aspect === '1:1' ? '1:1' : '4:5', labels: labels(call.step), model: IMAGE_QUALITY[call.quality].model });
      add(call.step, out.costUsd);
      return out.png;
    },
  };
}
