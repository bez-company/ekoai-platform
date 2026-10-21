// Fronteira entre produtos: este repositório é só da Ekoai. Infra, código, workflows e docs de outro
// produto da BEZ (Saint-Jardin e site da BEZ) moram no repositório dele; o que é da organização
// inteira mora em `bez-platform`. A marca de cliente no código tem a própria catraca (no-client-brand).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIRS = ['src', 'scripts', 'packages', 'platform/src', 'infra', 'docker', '.github', 'docs', 'tests'];
// CLAUDE.md fica de fora: é onde a própria regra de fronteira cita os nomes.
const FILES = ['package.json', '.env.example'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.terraform']);
const SELF = 'tests/product-boundaries.test.js';

const OTHER_PRODUCTS = [/saint[-_ ]jardin/i, /s[ãa]o jardim/i, /\bbez-site\b/i, /\bbez-website\b/i];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

function scannedFiles() {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
  for (const f of FILES) {
    try {
      statSync(join(ROOT, f));
      files.push(f);
    } catch {
      // opcional
    }
  }
  return files.filter((f) => f !== SELF && !/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|hcl)$/i.test(f));
}

describe('este repositório é só da Ekoai', () => {
  it('varre arquivos de verdade', () => {
    expect(scannedFiles().length).toBeGreaterThan(50);
  });

  it('nenhuma menção a outro produto da BEZ', () => {
    const hits = [];
    for (const f of scannedFiles()) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (OTHER_PRODUCTS.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits, `Mova para o repositório do produto:\n${hits.join('\n')}`).toEqual([]);
  });
});
