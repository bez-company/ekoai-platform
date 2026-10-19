// Catraca do ADR 0011: componentes da plataforma usam só tokens semânticos (bg-page, text-fg,
// border-line, bg-accent...). Cor crua do Tailwind ou hex no className quebra a troca de tema.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'platform/src');
const RAW = /\b(?:bg|text|border|ring|divide|from|to|via|fill|stroke|outline|placeholder|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;
const HEX_CLASS = /className=["'`{][^"'`}]*#[0-9a-fA-F]{3,8}/;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(full);
  }
  return out;
}

describe('design system nos componentes (ADR 0011)', () => {
  it('nenhuma cor crua do Tailwind nem hex em className', () => {
    const hits = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (RAW.test(line) || HEX_CLASS.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('o padrão pega cor crua e deixa token passar', () => {
    expect(RAW.test('className="text-red-400"')).toBe(true);
    expect(RAW.test('className="bg-white"')).toBe(true);
    expect(RAW.test('className="bg-accent text-on-accent border-line"')).toBe(false);
    expect(RAW.test('className="text-danger bg-warning/10"')).toBe(false);
  });
});
