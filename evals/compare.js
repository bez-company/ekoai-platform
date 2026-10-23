// compare.js: node evals/compare.js <antes.json> <depois.json>. Imprime a diferença entre dois baselines
// (os arquivos de evals/baselines/ ou o summary.json de uma rodada em .context/evals/).
import { readFileSync } from 'node:fs';
import { compare } from './report.js';

const [before, after] = process.argv.slice(2);
if (!before || !after) {
  process.stderr.write('uso: node evals/compare.js <antes.json> <depois.json>\n');
  process.exit(2);
}
const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
process.stdout.write(`${compare(load(before), load(after))}\n`);
