// studio-job.ts: ponto de entrada do Cloud Run Job `ekoai-studio` (SPEC 030 F3c). Empacotado por scripts/build-studio-job.mjs.
// Lê STUDIO_TENANT e STUDIO_BRIEF, monta o modelo (Vertex), o Chromium e a biblioteca, e roda uma execução.
import { join } from 'node:path';
import { tenantDb } from './src/lib/tenant-db';
import { vertexClient } from './src/lib/vertex';
import { log, logError } from './src/lib/log';
import { chromiumRenderer } from './src/lib/studio/chromium-renderer';
import { vertexStudioModel } from './src/lib/studio/vertex-model';
import { TEMPLATE_LIBRARY } from './src/lib/studio/library';
import { jobInputFrom, runStudioJob } from './src/lib/studio/job';

async function main(): Promise<number> {
  const input = jobInputFrom(process.env);
  const client = vertexClient();
  const renderer = chromiumRenderer({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', fontDir: process.env.STUDIO_FONT_DIR || join(process.cwd(), 'fonts') });
  try {
    const outcome = await runStudioJob(tenantDb(input.tenantId), input, { modelFor: (ctx) => vertexStudioModel(client, ctx), renderer, library: TEMPLATE_LIBRARY });
    log('info', 'studio-job', 'fim', { briefId: input.briefId, status: outcome.status });
    return 0;
  } finally {
    await renderer.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    logError('studio-job', e);
    process.exit(1);
  },
);
