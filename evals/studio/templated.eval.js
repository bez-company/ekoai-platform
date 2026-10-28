// templated.eval.js: spike do caminho rápido por template (BEZ-447). Pedidos NOVOS (fora dos que criaram os templates, em
// .context/studio/requests.holdout.json), latência por fase, custo e nota do juiz de design. Só roda com EVAL_LIVE=1.
//   STUDIO_RUN=tpl-1  STUDIO_CONCURRENCY=2  STUDIO_TPL_MODEL=fast|smart
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANIES } from '../cases.js';
import { DIMENSIONS } from './agents.js';
import { score } from './design-judge.js';
import { newLedger } from './llm.js';
import { closeBrowser } from './render.js';
import { makeTemplatedPost } from './templated.js';

const live = process.env.EVAL_LIVE === '1';
const root = join(import.meta.dirname, '../..');
const outDir = join(root, '.context/studio/runs', process.env.STUDIO_RUN || 'tpl-1');
const concurrency = Math.max(1, Number(process.env.STUDIO_CONCURRENCY ?? 2));
const model = process.env.STUDIO_TPL_MODEL || 'fast';
const seedOf = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 100000;
const design = (s) => Object.keys(DIMENSIONS).reduce((sum, k) => sum + Number(s?.[k] ?? 0), 0) / Object.keys(DIMENSIONS).length;
const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
const progress = (line) => writeFileSync(join(outDir, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${line}\n`, { flag: 'a' });
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

describe.skipIf(!live)('spike do caminho por template', () => {
  it('pedidos novos', { timeout: 3 * 3600_000 }, async () => {
    mkdirSync(outDir, { recursive: true });
    for (const id of ['fe', 'bez', 'ekoai']) COMPANIES[id] = JSON.parse(readFileSync(join(root, '.context/studio/brands', `${id}.json`), 'utf8'));
    const libDir = join(root, '.context/studio/library');
    const library = readdirSync(libDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(libDir, f), 'utf8'))).filter((t) => t.validation.hard.length <= 2);
    progress(`biblioteca: ${library.length} templates`);
    const holdout = JSON.parse(readFileSync(join(root, '.context/studio/requests.holdout.json'), 'utf8'));
    const jobs = Object.entries(holdout).flatMap(([brand, list]) => list.map((r) => ({ brand, ...r })));
    const rows = [];
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const t = jobs[next];
        next += 1;
        const dir = join(outDir, t.brand, t.id);
        mkdirSync(dir, { recursive: true });
        try {
          progress(`${t.brand}/${t.id} início`);
          const made = await makeTemplatedPost({ company: COMPANIES[t.brand], request: t.request, library, seed: seedOf(`${t.brand}/${t.id}`), model });
          write(join(dir, 'post.png'), made.png);
          write(join(dir, 'post.html'), made.html);
          const judged = await score({ company: COMPANIES[t.brand], request: t.request, caption: made.copy.caption, png: made.png, ledger: newLedger() });
          const row = { request: `${t.brand}/${t.id}`, template: made.template, design: design(judged.scores), postaria: judged.postaria, defeitos: judged.defeitos ?? [], seconds: made.seconds, timing: made.timing, costUsd: made.costUsd, layoutIssues: made.layoutIssues.map((i) => i.rule), textIssues: made.textIssues, headline: made.copy.headline };
          write(join(dir, 'row.json'), row);
          rows.push(row);
          progress(`${t.brand}/${t.id} pronto ${row.design.toFixed(1)} em ${row.seconds.toFixed(0)}s`);
        } catch (e) {
          progress(`${t.brand}/${t.id} FALHOU ${e.message}`);
        }
      }
    }));
    const sorted = rows.map((r) => r.seconds).sort((a, b) => a - b);
    write(join(outDir, 'summary.json'), { n: rows.length, templates: library.length, design: avg(rows.map((r) => r.design)), postaria: rows.filter((r) => r.postaria).length, secondsP50: sorted[Math.floor(sorted.length / 2)], secondsMax: sorted[sorted.length - 1], costUsd: avg(rows.map((r) => r.costUsd)), layoutIssues: rows.reduce((s, r) => s + r.layoutIssues.length, 0), rows });
    await closeBrowser();
  });
});
