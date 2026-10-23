// generation.eval.js: roda cada caso de cases.js no modelo de verdade (Vertex), desenha o PNG, pede ao juiz
// que confira as exigências e grava o relatório em .context/evals/<data>/. Só roda com EVAL_LIVE=1
// (gasta chamada paga). Uso: npm run eval (ver evals/README.md).

import { afterAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vertexClient, vertexConfig } from '../platform/src/lib/vertex.ts';
import { CASES } from './cases.js';
import { produce } from './pipeline.js';
import { buildJudgePrompt, parseJudge, scoreOf, verdictOf } from './judge.js';

const live = process.env.EVAL_LIVE === '1';
const only = (process.env.EVAL_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
const fontDir = join(import.meta.dirname, '../platform/fonts');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(import.meta.dirname, '../.context/evals', stamp);
const results = [];

const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));

function report(rows, models) {
  const total = scoreOf(rows.flatMap((r) => r.verdicts));
  const lines = [`# Eval da geração, ${stamp}`, '', `Modelos: texto \`${models.text}\`, imagem \`${models.image}\`, juiz \`${models.judge}\`.`, `Exigências cumpridas: **${total.passed} de ${total.total}** (${Math.round(total.rate * 100)}%). Custo: US$ ${rows.reduce((s, r) => s + r.costUsd, 0).toFixed(3)}.`, ''];
  for (const r of rows) {
    const s = scoreOf(r.verdicts);
    lines.push(`## ${r.id}: ${s.passed} de ${s.total}`, '', `Pedido: ${r.idea}`, '', `O juiz viu: ${r.seen || '(nada)'}`, '', `Layout: \`${r.layout}\`, tipo: \`${r.kind}\`, texto na imagem: ${r.imageTexts.map((t) => `"${t}"`).join(', ') || '(nenhum)'}`, '', '| Exigência | Resultado | Motivo |', '| --- | --- | --- |');
    for (const v of r.verdicts) lines.push(`| ${v.id} | ${v.pass ? 'passou' : 'reprovou'} | ${v.reason.replace(/\|/g, '/')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

describe.skipIf(!live)('eval da geração de post', () => {
  const cfg = vertexConfig({ VERTEX_LOCATION: 'global', VERTEX_TEXT_MODEL: 'gemini-3-flash-preview', VERTEX_IMAGE_MODEL: 'gemini-3.1-flash-image', ...process.env });
  const model = vertexClient({ config: cfg });
  const judgeModel = process.env.EVAL_JUDGE_MODEL || cfg.textModel;
  const judge = vertexClient({ config: { ...cfg, textModel: judgeModel } });
  mkdirSync(outDir, { recursive: true });

  for (const brief of cases) {
    it(brief.id, { timeout: 300_000 }, async () => {
      const made = await produce({ model, brief, fontDir });
      const dir = join(outDir, brief.id);
      mkdirSync(dir, { recursive: true });
      write(join(dir, 'post.png'), made.png);
      if (made.visualPng) write(join(dir, 'visual.png'), made.visualPng);
      write(join(dir, 'trace.json'), { idea: brief.idea, copy: made.copy, layout: made.spec.layout, visualPrompt: made.visualPrompt, textIssues: made.textIssues, layoutIssues: made.layoutIssues, rounds: made.trace });

      const prompt = buildJudgePrompt({ idea: brief.idea, requirements: brief.requirements, caption: made.copy.caption });
      const out = await judge.generateJson({ prompt, labels: { step: 'eval-judge', case: brief.id }, temperature: 0, image: { bytes: made.png, mimeType: 'image/png' } });
      const judged = parseJudge(out.json, brief.requirements);
      const verdicts = brief.requirements.map((req, i) => verdictOf(req, judged.items[i], made.imageTexts));
      results.push({ id: brief.id, idea: brief.idea, seen: judged.seen, kind: made.copy.kind, layout: made.spec.layout, imageTexts: made.imageTexts, verdicts, costUsd: made.costUsd + out.costUsd });
    });
  }

  afterAll(() => {
    if (!results.length) return;
    results.sort((a, b) => cases.findIndex((c) => c.id === a.id) - cases.findIndex((c) => c.id === b.id));
    write(join(outDir, 'results.json'), results);
    const md = report(results, { text: cfg.textModel, image: cfg.imageModel, judge: judgeModel });
    write(join(outDir, 'report.md'), md);
    process.stdout.write(`\n${md}\n\nRelatório: ${join(outDir, 'report.md')}\n`);
  });
});
