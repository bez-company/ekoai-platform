// Catraca do ADR 0010: nenhuma marca de cliente no código. A conta da Pilar existe no banco, como
// qualquer outra; o código não pode conhecê-la. Ficam de fora os docs (registro de decisão) e as
// migrations já aplicadas (0001 a 0016), que não se reescrevem. Migration nova é varrida.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIRS = ['src', 'scripts', 'packages', 'platform/src', 'supabase', 'docker', '.github', 'tests'];
const FILES = ['package.json', '.env.example', 'platform/package.json', 'platform/.env.local.example'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);
const APPLIED_MIGRATION = /^supabase\/migrations\/00(0[1-9]|1[0-6])_[^/]+\.sql$/;
const SELF = 'tests/no-client-brand.test.js';

// "pilar" sozinho é o conceito de pilar de conteúdo; o que se procura é a marca.
const BRAND = [
  /pilarsoft/i,
  /pilar\.software/i,
  /\bPILAR_[A-Z]/,
  /ops-export-funil/i,
  /\bprumeo\b/i,
  /\btrinity\b/i,
  /['"`]pilar['"`]/i,
  /\b(?:a|da|na|do|no|o|pela|pelo|com a) Pilar\b/,
];

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
      // arquivo opcional
    }
  }
  return files.filter((f) => f !== SELF && !APPLIED_MIGRATION.test(f) && !/\.(png|jpe?g|gif|webp|ico|pdf|woff2?)$/i.test(f));
}

describe('nenhuma marca de cliente no código (ADR 0010)', () => {
  it('varre arquivos de verdade', () => {
    expect(scannedFiles().length).toBeGreaterThan(50);
  });

  it('nenhum arquivo cita a Pilar como marca, domínio, variável ou id de conta', () => {
    const hits = [];
    for (const file of scannedFiles()) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (BRAND.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('o padrão pega o que deveria e deixa o conceito de pilar de conteúdo', () => {
    const flagged = (s) => BRAND.some((re) => re.test(s));
    expect(flagged("return process.env.TENANT_ID || 'pilar';")).toBe(true);
    expect(flagged('Teste a Pilar grátis')).toBe(true);
    expect(flagged('https://pilarsoft.com.br')).toBe(true);
    expect(flagged('PILAR_FUNNEL_URL=')).toBe(true);
    expect(flagged('Média por pilar (30d)')).toBe(false);
    expect(flagged("const p = s.item.pillar || 'sem-pilar';")).toBe(false);
  });
});
