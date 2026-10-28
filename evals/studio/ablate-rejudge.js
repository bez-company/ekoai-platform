// ablate-rejudge.js: ablação do refino sem gerar de novo. Para cada post de uma rodada, o juiz de design (o mesmo do eval)
// nota as versões intermediárias que o pipeline guardou: o primeiro rascunho (sem segundo rascunho e sem refino), o melhor
// rascunho (com o melhor de 2, sem refino) e a final (com tudo). Compara as médias. Uso:
//   node evals/studio/ablate-rejudge.js <pasta da rodada em .context/studio/runs/> [marcas.json dir]
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIMENSIONS } from './agents.js';
import { score } from './design-judge.js';

const dir = process.argv[2];
if (!dir) throw new Error('Uso: node evals/studio/ablate-rejudge.js <pasta da rodada>');
const brandsDir = join(import.meta.dirname, '../../.context/studio/brands');
const design = (s) => Object.keys(DIMENSIONS).reduce((sum, k) => sum + Number(s?.[k] ?? 0), 0) / Object.keys(DIMENSIONS).length;
const rows = [];

for (const brand of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const company = JSON.parse(readFileSync(join(brandsDir, `${brand.name}.json`), 'utf8'));
  for (const req of readdirSync(join(dir, brand.name), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, brand.name, d.name, 'studio-trace.json')))) {
    const base = join(dir, brand.name, req.name);
    const trace = JSON.parse(readFileSync(join(base, 'studio-trace.json'), 'utf8'));
    const row = JSON.parse(readFileSync(join(base, 'row.json'), 'utf8'));
    const its = trace.trace.iterations;
    const drafts = its.map((it, i) => ({ it, i })).filter((x) => x.it.kind.startsWith('rascunho'));
    const first = drafts.find((x) => x.it.kind === 'rascunho-1') ?? drafts[0];
    const best = drafts.reduce((a, b) => (b.it.score > a.it.score ? b : a));
    const judge = async (x) => design((await score({ company, request: row.request, caption: trace.copy.caption, png: readFileSync(join(base, `studio-iter-${x.i + 1}.png`)) })).scores);
    const first1 = await judge(first);
    const bestDraft = best.i === first.i ? first1 : await judge(best);
    const final = design(row.arms.studio.judged.scores);
    rows.push({ id: `${brand.name}/${req.name}`, firstDraft: first1, bestDraft, final });
  }
}
const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const out = { n: rows.length, firstDraft: avg('firstDraft'), bestOfTwo: avg('bestDraft'), final: avg('final'), rows };
writeFileSync(join(dir, 'ablation-refine.json'), JSON.stringify(out, null, 2));
process.stdout.write(`${JSON.stringify({ n: out.n, primeiroRascunho: +out.firstDraft.toFixed(2), melhorDe2: +out.bestOfTwo.toFixed(2), final: +out.final.toFixed(2) })}\n`);
for (const r of rows) process.stdout.write(`${r.id}: ${r.firstDraft.toFixed(1)} -> ${r.bestDraft.toFixed(1)} -> ${r.final.toFixed(1)}\n`);
