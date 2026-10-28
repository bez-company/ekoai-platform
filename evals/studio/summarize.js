// summarize.js: refaz o report.md e o summary.json de uma rodada do eval do estúdio a partir do que ficou em disco
// (results.json e as pastas de variação). Serve quando a rodada foi interrompida. Uso:
//   node evals/studio/summarize.js <pasta em .context/studio/runs/> [nome para gravar em evals/studio/baselines/]
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { summarize } from './report.js';

const [dir, save] = process.argv.slice(2);
if (!dir) throw new Error('Uso: node evals/studio/summarize.js <pasta da rodada> [nome]');
// Cada pedido grava o próprio row.json; é a fonte (o results.json é só o parcial de um processo).
const rows = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((b) => readdirSync(join(dir, b.name), { withFileTypes: true }).filter((r) => r.isDirectory() && existsSync(join(dir, b.name, r.name, 'row.json'))).map((r) => JSON.parse(readFileSync(join(dir, b.name, r.name, 'row.json'), 'utf8'))));
const variationRows = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'variacao', 'variacao.json')))
  .map((d) => JSON.parse(readFileSync(join(dir, d.name, 'variacao', 'variacao.json'), 'utf8')));
const arms = [...new Set(rows.flatMap((r) => Object.keys(r.arms)))];
const meta = { stamp: dir.split('/').pop(), brands: [...new Set(rows.map((r) => r.brand))], perBrand: Math.round(rows.length / new Set(rows.map((r) => r.brand)).size), variations: variationRows[0]?.count ?? 0 };
const out = summarize({ rows, variationRows, arms, meta });
writeFileSync(join(dir, 'summary.json'), JSON.stringify(out.json, null, 2));
writeFileSync(join(dir, 'report.md'), out.markdown);
if (save) {
  const target = join(import.meta.dirname, 'baselines');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${save}.json`), JSON.stringify(out.json, null, 2));
}
