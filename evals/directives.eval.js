// directives.eval.js: mede só o leitor de instruções (SPEC 020), sem gerar post: uma chamada de texto por
// caso, barata (frações de centavo), para ajustar o prompt do leitor. Só roda com EVAL_LIVE=1.
//   EVAL_RUNS=3 VERTEX_PROJECT_ID=ekoai-prod npm run eval:directives

import { afterAll, describe, it } from 'vitest';
import { vertexClient, vertexConfig } from '../platform/src/lib/vertex.ts';
import { evalEnv, budgetedClient } from './guard.js';
import { buildDirectivesPrompt, parseDirectives } from '../platform/src/lib/directives.ts';
import { COMPANIES } from './cases.js';
import { ALL_CASES as CASES } from './all-cases.js';
import { compareDirectives } from './metrics.js';

const live = process.env.EVAL_LIVE === '1';
const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
const results = [];

describe.skipIf(!live)('leitor de instruções', () => {
  const cfg = vertexConfig({ VERTEX_LOCATION: 'global', VERTEX_TEXT_MODEL: 'gemini-3-flash-preview', ...evalEnv() });
  const model = budgetedClient(vertexClient({ config: cfg }));

  describe.concurrent('casos', () => {
    for (const brief of CASES.filter((c) => c.directives)) {
      for (let run = 1; run <= runs; run += 1) {
        it(`${brief.id} #${run}`, { timeout: 120_000 }, async () => {
          const company = COMPANIES[brief.company];
          const prompt = buildDirectivesPrompt(brief.idea, { name: company.name, hasLogo: !!company.logo, handle: company.handle });
          const out = await model.generateJson({ prompt, labels: { step: 'eval-directives', case: brief.id }, maxOutputTokens: 1024, temperature: 0 });
          const parsed = parseDirectives(out.json, brief.idea);
          const verdict = compareDirectives(brief.directives, parsed.directives);
          results.push({ id: brief.id, run, pass: verdict.pass, reason: verdict.reason, got: parsed.directives, dropped: parsed.dropped, costUsd: out.costUsd });
        });
      }
    }
  });

  afterAll(() => {
    if (!results.length) return;
    const passed = results.filter((r) => r.pass).length;
    const lines = [`# Leitor de instruções: ${passed} de ${results.length} (${Math.round((passed / results.length) * 100)}%), modelo ${cfg.textModel}, US$ ${results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`, ''];
    for (const r of results.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run).filter((r) => !r.pass)) {
      lines.push(`- ${r.id} #${r.run}: ${r.reason}${r.dropped.length ? ` (descartado: ${r.dropped.join('; ')})` : ''}\n  veio: ${JSON.stringify(r.got)}`);
    }
    process.stdout.write(`\n${lines.join('\n')}\n`);
  });
});
