import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// O eval da geração (evals/): chama o Vertex de verdade e custa dinheiro, então fica fora da suíte
// normal. Só roda com EVAL_LIVE=1: npm run eval.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./platform/src', import.meta.url)) } },
  test: { include: ['evals/**/*.eval.js'], testTimeout: 600_000, fileParallelism: false, maxConcurrency: 8 },
});
