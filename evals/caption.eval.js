// caption.eval.js: o eval da legenda e das hashtags (BEZ-373). Só texto, sem imagem: roda o redator de verdade (Vertex)
// com o mesmo prompt e o mesmo revisor da geração, e um juiz lê a legenda contra as exigências de caption-cases.js.
// Só roda com EVAL_LIVE=1. Uso: npm run eval:caption (evals/README.md).
//
//   EVAL_CASES=id1,id2   só estes casos          EVAL_RUNS=3   rodadas por caso (o modelo varia)
//   EVAL_SAVE=nome       grava o resumo em evals/baselines/nome.json
//   EVAL_JUDGE_MODEL     modelo do juiz (padrão gemini-3.1-pro-preview)

import { afterAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vertexClient, vertexConfig } from '../platform/src/lib/vertex.ts';
import { evalEnv } from './guard.js';
import { CRAFT } from './cases.js';
import { CAPTION_CASES, CAPTION_COMPANIES, CAPTION_CRAFT } from './caption-cases.js';
import { writeCopy } from './pipeline.js';
import { buildCaptionJudgePrompt } from './caption-judge.js';
import { parseJudge } from './judge.js';
import { captionChecks } from './metrics.js';
import { renderSummary, summarize } from './report.js';

const live = process.env.EVAL_LIVE === '1';
const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const onlyCases = list(process.env.EVAL_CASES);
const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
const cases = CAPTION_CASES.filter((c) => !onlyCases.length || onlyCases.includes(c.id));
const root = join(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(root, '.context/evals', `legenda-${stamp}`);
const rows = [];
const write = (path, data) => writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2));

describe.skipIf(!live)('eval da legenda e das hashtags', () => {
  const cfg = vertexConfig({ VERTEX_LOCATION: 'global', VERTEX_TEXT_MODEL: 'gemini-3-flash-preview', ...evalEnv() });
  const judgeModel = process.env.EVAL_JUDGE_MODEL || 'gemini-3.1-pro-preview';
  const model = vertexClient({ config: cfg });
  const judge = vertexClient({ config: { ...cfg, textModel: judgeModel } });
  mkdirSync(outDir, { recursive: true });

  describe.concurrent('casos', () => {
    for (const brief of cases) {
      for (let run = 1; run <= runs; run += 1) {
        it(`${brief.id} #${run}`, { timeout: 300_000 }, async () => {
          const company = CAPTION_COMPANIES[brief.company];
          const dir = join(outDir, brief.id, `run-${run}`);
          mkdirSync(dir, { recursive: true });
          const { copy, issues, trace } = await writeCopy({ model, brief: { id: brief.id, idea: brief.idea, kind: 'informativo' }, company, plan: null });
          const requirements = [...brief.requirements.map((r) => ({ ...r, group: 'pedido' })), ...CRAFT.filter((r) => CAPTION_CRAFT.includes(r.id)).map((r) => ({ ...r, group: 'oficio' }))];
          const prompt = buildCaptionJudgePrompt({ idea: brief.idea, requirements, copy, company });
          let judged = null;
          let judgeCost = 0;
          for (let attempt = 1; attempt <= 2 && !judged?.answered; attempt += 1) {
            try {
              const out = await judge.generateJson({ prompt, labels: { step: 'eval-caption-judge', case: brief.id }, temperature: 0, maxOutputTokens: 4096 });
              judgeCost += out.costUsd;
              judged = parseJudge(out.json, requirements);
            } catch {
              judged = null;
            }
          }
          const cost = trace.reduce((s, t) => s + t.costUsd, 0) + judgeCost;
          write(join(dir, 'trace.json'), { idea: brief.idea, profile: company.profile, copy, textIssues: issues, rounds: trace.map((t) => ({ round: t.round, raw: t.raw })), judge: judged });
          if (!judged?.answered) {
            rows.push({ caseId: brief.id, run, tags: brief.tags, judgeFailed: true, verdicts: [], costUsd: cost });
            return;
          }
          const verdicts = [
            ...requirements.map((req, i) => ({ id: req.id, pass: judged.items[i].pass, reason: judged.items[i].reason, group: req.group, by: 'judge' })),
            ...captionChecks({ copy, profile: company.profile }).map((c) => ({ ...c, reason: c.pass ? '' : c.reason, group: 'codigo', by: 'code' })),
          ];
          write(join(dir, 'verdicts.json'), { seen: judged.seen, verdicts });
          rows.push({ caseId: brief.id, run, tags: brief.tags, rounds: trace.length, seen: judged.seen, caption: copy.caption, hashtags: copy.hashtags, verdicts, costUsd: cost });
        });
      }
    }
  });

  afterAll(() => {
    if (!rows.length) return;
    const summary = summarize(rows, { stamp, text: cfg.textModel, image: 'sem imagem', judge: judgeModel });
    write(join(outDir, 'results.json'), rows);
    write(join(outDir, 'summary.json'), summary);
    const failed = rows.flatMap((r) => r.verdicts.filter((v) => !v.pass).map((v) => `- ${r.caseId} #${r.run} / ${v.id}: ${v.reason}`));
    const seen = rows.map((r) => `### ${r.caseId} #${r.run}\n\n${r.caption}\n\n${(r.hashtags ?? []).map((h) => `#${h}`).join(' ')}`);
    const md = `${renderSummary(summary)}\n\n## Reprovações\n\n${failed.join('\n') || '(nenhuma)'}\n\n## Legendas geradas\n\n${seen.join('\n\n')}\n`;
    write(join(outDir, 'report.md'), md);
    if (process.env.EVAL_SAVE) {
      mkdirSync(join(root, 'evals/baselines'), { recursive: true });
      write(join(root, 'evals/baselines', `${process.env.EVAL_SAVE}.json`), summary);
    }
    process.stdout.write(`\n${md}\nRelatório: ${join(outDir, 'report.md')}\n`);
  });
});
