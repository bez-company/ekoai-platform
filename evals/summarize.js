// summarize.js: node evals/summarize.js <pasta de .context/evals> [nome-do-baseline]. Resume o results.json de uma
// rodada (inclusive uma interrompida, que grava resultado parcial a cada post) e, com o nome, grava o baseline.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSummary, summarize } from './report.js';

const [dir, name] = process.argv.slice(2);
if (!dir) {
  process.stderr.write('uso: node evals/summarize.js <pasta de .context/evals> [nome-do-baseline]\n');
  process.exit(2);
}
const root = join(import.meta.dirname, '..');
const folder = dir.startsWith('/') ? dir : join(root, '.context/evals', dir);
const rows = JSON.parse(readFileSync(join(folder, 'results.json'), 'utf8'));
const meta = { stamp: folder.split('/').pop(), text: process.env.VERTEX_TEXT_MODEL || 'gemini-3-flash-preview', image: process.env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image', judge: process.env.EVAL_JUDGE_MODEL || 'gemini-3.1-pro-preview' };
const summary = summarize(rows, meta);
process.stdout.write(`${renderSummary(summary)}\n`);
if (name) writeFileSync(join(root, 'evals/baselines', `${name}.json`), `${JSON.stringify(summary, null, 2)}\n`);
